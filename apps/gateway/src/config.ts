import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { GATEWAY_SERIAL, isClaimCode, normalizeClaimCode } from '@ecomanage/shared';
import type { ModbusTarget } from './modbus/link';

// The gateway's settings (P5-04). Two files: the factory file (serial and claim code, from
// `gateway:register`, on the SD card) and the config (broker, certificates, what to scan, the
// OCPP port). Devices come from commissioning, which the gateway remembers; the config may list
// some up front (a bench, or a site set up offline).

const factoryFile = z.object({
  serial: z.string().regex(GATEWAY_SERIAL),
  claimCode: z.string().transform(normalizeClaimCode).refine(isClaimCode, 'Not a claim code'),
});
export type Factory = z.infer<typeof factoryFile>;

const tcp = z.object({ host: z.string().min(1), port: z.number().int().positive().default(502), unitId: z.number().int().min(0).max(255).default(1) });
const rtu = z.object({
  path: z.string().min(1), // /dev/ttyUSB0 or /dev/serial/by-id/…
  baudRate: z.number().int().positive().default(9600),
  parity: z.enum(['none', 'even', 'odd']).default('none'),
  unitId: z.number().int().min(1).max(247),
});

export const deviceConfig = z.object({
  id: z.string().min(1), // the cloud's device id
  profileId: z.string(),
  type: z.string().default(''),
  address: z.string().default(''),
  modbus: z.union([tcp.strict(), rtu.strict()]).optional(),
  // Profile registers + offset: -1 for a device documented from 1 (40001-style), or where its
  // SunSpec block starts elsewhere.
  regOffset: z.number().int().default(0),
  ocpp: z.object({ chargePointId: z.string().min(1), connectorId: z.number().int().positive().default(1) }).optional(),
});
export type DeviceConfig = z.infer<typeof deviceConfig>;

export const gatewayConfig = z.object({
  mqttUrl: z.string().url(),
  dataDir: z.string().default('/var/lib/ecomanage-gateway'),
  factoryFile: z.string().default('/boot/firmware/ecomanage/factory.json'),
  // The shared certificate a gateway not yet claimed connects with.
  bootstrap: z.object({ cert: z.string(), key: z.string(), ca: z.string() }),
  statusEveryMs: z.number().int().min(5000).default(30_000),
  timeoutMs: z.number().int().min(100).default(1000), // per Modbus request
  scan: z
    .object({
      // Hosts or /24 networks to look for Modbus TCP (port 502), e.g. "192.168.1.0/24".
      tcp: z.array(z.string()).default([]),
      tcpPort: z.number().int().positive().default(502),
      rtu: z.array(z.object({ path: z.string(), baudRate: z.number().int().positive().default(9600), parity: z.enum(['none', 'even', 'odd']).default('none'), ids: z.tuple([z.number().int().min(1), z.number().int().max(247)]).default([1, 16]) })).default([]),
    })
    .default({ tcp: [], tcpPort: 502, rtu: [] }),
  ocpp: z.object({ port: z.number().int().positive().default(8887), password: z.string().optional() }).nullable().default({ port: 8887 }),
  devices: z.array(deviceConfig).default([]),
});
export type GatewayConfig = z.infer<typeof gatewayConfig>;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export const loadConfig = (path: string): GatewayConfig => {
  const parsed = gatewayConfig.safeParse(readJson(path));
  if (!parsed.success) throw new Error(`Invalid gateway config ${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
};

export const loadFactory = (path: string): Factory => {
  const parsed = factoryFile.safeParse(readJson(path));
  if (!parsed.success) throw new Error(`Invalid factory file ${path}`);
  return parsed.data;
};

/** How to reach a Modbus device in the config. */
export const modbusTarget = (d: DeviceConfig, timeoutMs: number): ModbusTarget | null => {
  if (!d.modbus) return null;
  return 'host' in d.modbus ? { kind: 'tcp', ...d.modbus, timeoutMs } : { kind: 'rtu', ...d.modbus, timeoutMs };
};

// ---- addresses -----------------------------------------------------------------------------------

// What the scan reports and commissioning passes back: enough to reach the device again.
//   "TCP · 192.168.1.50:502 · id 1", "RS-485 · ttyUSB0 · id 7", "OCPP · EVC-01"

export const tcpAddress = (host: string, port: number, unitId: number) => `TCP · ${host}:${port} · id ${unitId}`;
export const rtuAddress = (path: string, unitId: number) => `RS-485 · ${path.replace(/^\/dev\//, '')} · id ${unitId}`;
export const ocppAddress = (chargePointId: string) => `OCPP · ${chargePointId}`;

export type ParsedAddress =
  | { kind: 'tcp'; host: string; port: number; unitId: number }
  | { kind: 'rtu'; path: string; unitId: number }
  | { kind: 'ocpp'; chargePointId: string };

export const parseAddress = (address: string): ParsedAddress | null => {
  let m = /^TCP · ([^:\s]+):(\d+) · id (\d+)$/.exec(address);
  if (m) return { kind: 'tcp', host: m[1], port: Number(m[2]), unitId: Number(m[3]) };
  m = /^RS-485 · (\S+) · id (\d+)$/.exec(address);
  if (m) return { kind: 'rtu', path: m[1].startsWith('/') ? m[1] : `/dev/${m[1]}`, unitId: Number(m[2]) };
  m = /^OCPP · (\S+)$/.exec(address);
  return m ? { kind: 'ocpp', chargePointId: m[1] } : null;
};
