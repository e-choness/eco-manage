import { Socket } from 'node:net';
import type { FoundDevice } from '@ecomanage/shared';
import { decodeValue } from './modbus/decode';
import { modbusIO, type ModbusIO } from './modbus/link';
import { ocppAddress, rtuAddress, tcpAddress, type GatewayConfig } from './config';
import type { Charger } from './ocpp/server';

// "Scan" in the app (P5-04, Data and Device Audit §4 step 02): Modbus TCP devices on the LAN with
// the SunSpec "SunS" marker at 40000 (or 50000), meters on the RS-485 buses, and chargers that have
// connected to the OCPP server. Must finish well inside the cloud's 20 s wait.

const SUNS = [0x5375, 0x6e53]; // "SunS"
const INVERTER_MODELS = new Set([101, 102, 103, 111, 112, 113]);
const STORAGE_MODELS = new Set([802]);

/** Hosts from "192.168.1.0/24" (1–254) or single addresses. */
export const expandHosts = (specs: string[]): string[] =>
  specs.flatMap((s) => {
    const m = /^(\d+\.\d+\.\d+)\.\d+\/24$/.exec(s.trim());
    return m ? Array.from({ length: 254 }, (_, i) => `${m[1]}.${i + 1}`) : [s.trim()];
  });

const portOpen = (host: string, port: number, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    const s = new Socket();
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host, () => done(true));
  });

const text = (words: number[]) =>
  Buffer.from(words.flatMap((w) => [w >> 8, w & 0xff]))
    .toString('latin1')
    .replace(/\0.*$/s, '')
    .trim();

/** A SunSpec device's maker, model and the models it implements, or null if it isn't one. */
export const readSunSpec = async (io: ModbusIO): Promise<{ maker: string; model: string; models: number[] } | null> => {
  for (const base of [40000, 50000]) {
    let marker: number[];
    try {
      marker = await io.read('holding', base, 2);
    } catch {
      continue;
    }
    if (marker[0] !== SUNS[0] || marker[1] !== SUNS[1]) continue;
    const models: number[] = [];
    let maker = '';
    let model = '';
    let at = base + 2;
    for (let i = 0; i < 40; i++) {
      const [id, len] = await io.read('holding', at, 2);
      if (id === 0xffff || len === undefined) break;
      models.push(id);
      if (id === 1) {
        const common = await io.read('holding', at + 2, 32);
        maker = text(common.slice(0, 16));
        model = text(common.slice(16, 32));
      }
      at += 2 + len;
    }
    return { maker, model, models };
  }
  return null;
};

export const sunSpecFound = (address: string, s: { maker: string; model: string; models: number[] }): FoundDevice | null => {
  const storage = s.models.some((m) => STORAGE_MODELS.has(m));
  const inverter = s.models.some((m) => INVERTER_MODELS.has(m));
  if (!storage && !inverter) return null;
  const name = `${s.maker} ${s.model}`.trim() || (storage ? 'SunSpec battery' : 'SunSpec inverter');
  return storage
    ? { address, modelCode: s.model, profileId: 'sunspec-storage-802@2', type: 'battery', name }
    : { address, modelCode: s.model, profileId: 'sunspec-inverter@3', type: 'pv', name };
};

/** A three-phase meter answering at this unit id: phase voltage in a sensible range. */
const isMeter = async (io: ModbusIO): Promise<boolean> => {
  try {
    const v = decodeValue('float32', await io.read('input', 0, 2));
    return v !== null && v > 80 && v < 500;
  } catch {
    return false;
  }
};

export interface ScanDeps {
  chargers: () => Charger[];
  known: (address: string) => boolean;
  io?: (target: Parameters<typeof modbusIO>[0]) => ModbusIO;
}

export const scan = async (cfg: GatewayConfig, deps: ScanDeps): Promise<FoundDevice[]> => {
  const io = deps.io ?? modbusIO;
  const found: FoundDevice[] = [];

  // Modbus TCP: which hosts listen (502), then which of those are SunSpec (unit 1, then 126).
  const port = cfg.scan.tcpPort;
  const hosts = expandHosts(cfg.scan.tcp);
  const open: string[] = [];
  for (let i = 0; i < hosts.length; i += 64) {
    const batch = hosts.slice(i, i + 64);
    const res = await Promise.all(batch.map((h) => portOpen(h, port, 400)));
    open.push(...batch.filter((_, j) => res[j]));
  }
  for (const host of open) {
    for (const unitId of [1, 126]) {
      const s = await readSunSpec(io({ kind: 'tcp', host, port, unitId, timeoutMs: 800 })).catch(() => null);
      const f = s && sunSpecFound(tcpAddress(host, port, unitId), s);
      if (f) {
        found.push(f);
        break;
      }
    }
  }

  // RS-485: each unit id in the configured range, briefly.
  for (const bus of cfg.scan.rtu) {
    for (let id = bus.ids[0]; id <= bus.ids[1]; id++) {
      if (await isMeter(io({ kind: 'rtu', path: bus.path, baudRate: bus.baudRate, parity: bus.parity, unitId: id, timeoutMs: 250 })))
        found.push({ address: rtuAddress(bus.path, id), modelCode: '', profileId: 'ct-meter-3ph@2', type: 'submeter', name: `Meter · RS-485 id ${id}` });
    }
  }

  // Chargers that have connected to the OCPP server.
  for (const c of deps.chargers()) {
    if (!c.connected) continue;
    found.push({ address: ocppAddress(c.id), modelCode: c.model ?? '', profileId: 'ocpp16-generic@1', type: 'ev', name: [c.vendor, c.model].filter(Boolean).join(' ') || `Charger ${c.id}` });
  }
  return found.filter((f) => !deps.known(f.address));
};
