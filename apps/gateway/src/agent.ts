import { getProfile, type DeviceProfile } from '@ecomanage/profiles';
import { buildingKw, isLoad, jobMessage, parseTopic, telemetryReading, topics, gatewayConfigMessage, type DeviceType, type FoundDevice, type JobResultMessage, type TelemetryReading } from '@ecomanage/shared';
import { Commands, type Logger } from './commands';
import { deviceConfig, modbusTarget, parseAddress, type DeviceConfig, type GatewayConfig } from './config';
import { modbusDriver } from './drivers/modbus';
import { ocppDriver } from './drivers/ocpp';
import type { Driver } from './drivers/types';
import { modbusIO, type ModbusIO } from './modbus/link';
import type { OcppServer } from './ocpp/server';
import { scan, type ScanDeps } from './scan';
import type { Store } from './store';
import { FW } from './uplink';

// The gateway agent (P5-04): polls each device from its profile, sends readings (or keeps them
// while the cloud is away and resends them in order), reports its status, and carries out the
// cloud's commands and jobs. The uplink, OCPP server and Modbus access are passed in, so the tests
// can run it against fakes.

export interface Link {
  readonly siteId: string | null;
  online(): boolean;
  publish(topic: string, payload: unknown, retain?: boolean): Promise<boolean>;
}

interface Running {
  cfg: DeviceConfig;
  profile: DeviceProfile;
  driver: Driver;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  failures: number;
  latest: TelemetryReading | null;
}

const BATCH = 500;
const FAILS_BEFORE_NO_RESPONSE = 3;

export interface AgentDeps {
  cfg: GatewayConfig;
  store: Store;
  link: Link;
  log: Logger;
  ocpp?: OcppServer;
  io?: (target: Parameters<typeof modbusIO>[0]) => ModbusIO;
  exit?: () => void;
  now?: () => number;
}

export class Agent {
  private readonly devices = new Map<string, Running>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly startedAt: number;
  private flushing = false;
  readonly commands: Commands;

  constructor(private readonly d: AgentDeps) {
    this.startedAt = this.now();
    this.commands = new Commands(d.store, (id) => this.devices.get(id) && { id, profile: this.devices.get(id)!.profile, driver: this.devices.get(id)!.driver }, d.log, () => this.now());
  }

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  // ---- devices ---------------------------------------------------------------------------------

  /** The config's devices, then the ones commissioning added (those win for the same id). */
  loadDevices(): void {
    const all = new Map<string, DeviceConfig>();
    for (const c of this.d.cfg.devices) all.set(c.id, c);
    for (const raw of this.d.store.devices<unknown>()) {
      const c = deviceConfig.safeParse(raw);
      if (c.success) all.set(c.data.id, c.data);
    }
    for (const c of all.values()) this.addDevice(c, false);
  }

  private driverFor(c: DeviceConfig, profile: DeviceProfile): Driver | null {
    const target = modbusTarget(c, this.d.cfg.timeoutMs);
    if (target) return modbusDriver(profile, (this.d.io ?? modbusIO)(target), c.regOffset);
    if (c.ocpp && this.d.ocpp) return ocppDriver(profile, this.d.ocpp, c.ocpp.chargePointId, c.ocpp.connectorId);
    return null;
  }

  addDevice(c: DeviceConfig, remember: boolean): Running | null {
    const profile = getProfile(c.profileId);
    if (!profile) {
      this.d.log.warn({ deviceId: c.id, profileId: c.profileId }, 'unknown profile: device skipped');
      return null;
    }
    const driver = this.driverFor(c, profile);
    if (!driver) {
      this.d.log.warn({ deviceId: c.id, protocol: profile.protocol }, 'no way to reach this device: skipped');
      return null;
    }
    this.stopDevice(c.id);
    const r: Running = { cfg: c, profile, driver, timer: null, busy: false, failures: 0, latest: null };
    this.devices.set(c.id, r);
    if (remember) this.d.store.saveDevice(c.id, c);
    return r;
  }

  private stopDevice(id: string): void {
    const r = this.devices.get(id);
    if (r?.timer) clearInterval(r.timer);
    this.devices.delete(id);
  }

  private startPolling(r: Running): void {
    if (r.timer) return;
    r.timer = setInterval(() => void this.poll(r), r.profile.pollMs);
    void this.poll(r);
  }

  /** Readings in the site's sign convention: a meter measuring a load reads it as negative. */
  private toReading(r: Running, fields: Record<string, unknown>): TelemetryReading | null {
    const f = { ...fields };
    if (typeof f.p_kw === 'number' && r.cfg.type === 'submeter' && r.profile.deviceTypes.includes('meter')) f.p_kw = -f.p_kw;
    const parsed = telemetryReading.safeParse({ ts: new Date(this.now()).toISOString(), ...f, q: 'ok' });
    return parsed.success ? parsed.data : null;
  }

  async poll(r: Running): Promise<TelemetryReading | null> {
    if (r.busy) return null;
    r.busy = true;
    try {
      const reading = this.toReading(r, await r.driver.read());
      if (!reading) throw new Error('The device gave no power reading');
      if (r.failures >= FAILS_BEFORE_NO_RESPONSE) await this.status(r, 'running');
      r.failures = 0;
      r.latest = reading;
      await this.send(r.cfg.id, reading);
      return reading;
    } catch (err) {
      r.failures++;
      if (r.failures === FAILS_BEFORE_NO_RESPONSE) {
        this.d.log.warn({ deviceId: r.cfg.id, err: err instanceof Error ? err.message : String(err) }, 'device not answering');
        await this.status(r, 'no response', [{ code: 'no-response', text: err instanceof Error ? err.message : 'No response' }]);
      }
      return null;
    } finally {
      r.busy = false;
    }
  }

  private async status(r: Running, state: string, fault: { code: string; text: string }[] = []): Promise<void> {
    const site = this.d.link.siteId;
    if (site && this.d.link.online()) await this.d.link.publish(topics.deviceStatus(site, r.cfg.id), { ts: new Date(this.now()).toISOString(), state, fault });
  }

  // ---- delivery --------------------------------------------------------------------------------

  /** Sends now, unless older readings are waiting (they go first) or the cloud is away. */
  async send(deviceId: string, reading: TelemetryReading): Promise<void> {
    const site = this.d.link.siteId;
    if (site && this.d.link.online() && this.d.store.count() === 0 && (await this.d.link.publish(topics.telemetry(site, deviceId), reading))) return;
    this.d.store.push(deviceId, reading);
  }

  /** Resends kept readings in order, a batch at a time per device. */
  async flush(): Promise<number> {
    const site = this.d.link.siteId;
    if (this.flushing || !site || !this.d.link.online()) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      for (;;) {
        const rows = this.d.store.peek(BATCH);
        if (!rows.length) break;
        // Per device, in order; a batch is delivered before the rows are dropped.
        const byDevice = new Map<string, TelemetryReading[]>();
        for (const row of rows) byDevice.set(row.deviceId, [...(byDevice.get(row.deviceId) ?? []), row.reading]);
        for (const [deviceId, items] of byDevice) if (!(await this.d.link.publish(topics.telemetry(site, deviceId), { items }))) return sent;
        this.d.store.ack(rows[rows.length - 1].id);
        sent += rows.length;
      }
      return sent;
    } finally {
      this.flushing = false;
    }
  }

  async publishStatus(): Promise<void> {
    const site = this.d.link.siteId;
    if (!site || !this.d.link.online()) return;
    await this.d.link.publish(
      topics.gatewayStatus(site),
      { ts: new Date(this.now()).toISOString(), fw: FW, uptimeS: Math.round((this.now() - this.startedAt) / 1000), buffered: this.d.store.count(), oldestBufferedTs: this.d.store.oldestTs(), clockOffsetMs: 0 },
      true
    );
  }

  // ---- messages from the cloud -------------------------------------------------------------------

  async handle(topic: string, payload: unknown): Promise<void> {
    const t = parseTopic(topic);
    const site = this.d.link.siteId;
    if (!t || t.siteId !== site) return;
    if (t.kind === 'gatewayConfig') {
      const c = gatewayConfigMessage.safeParse(payload);
      if (c.success) this.commands.setFloor(c.data.batteryFloorPct);
      return;
    }
    if (t.kind === 'command') {
      const ack = await this.commands.handle(payload);
      await this.d.link.publish(topics.commandAck(site, t.commandId), ack);
      return;
    }
    if (t.kind === 'job') {
      const result = await this.job(payload);
      await this.d.link.publish(topics.jobResult(site, t.jobId), result);
      if (result.ok && (payload as { type?: string })?.type === 'restart') setTimeout(() => (this.d.exit ?? (() => process.exit(0)))(), 1000);
    }
  }

  private async job(payload: unknown): Promise<JobResultMessage> {
    const result = (ok: boolean, data: Record<string, unknown>, error?: string): JobResultMessage => ({ ok, ts: new Date(this.now()).toISOString(), data, ...(error ? { error } : {}) });
    const parsed = jobMessage.safeParse(payload);
    if (!parsed.success) return result(false, {}, 'malformed job');
    const { type, params } = parsed.data;
    if (type === 'restart') return result(true, {}); // the service manager starts it again
    if (type === 'scan') {
      try {
        const deps: ScanDeps = { chargers: () => this.d.ocpp?.chargers() ?? [], known: (a) => [...this.devices.values()].some((r) => r.cfg.address === a), io: this.d.io };
        const found = await scan(this.d.cfg, deps);
        this.d.store.set('lastScan', found);
        return result(true, { found });
      } catch (err) {
        return result(false, {}, err instanceof Error ? err.message : 'The scan failed');
      }
    }
    return this.commission(String(params.deviceId ?? ''), String(params.address ?? ''), result);
  }

  // ---- commissioning (Data and Device Audit §4 step 05) --------------------------------------------

  private async commission(deviceId: string, address: string, result: (ok: boolean, data: Record<string, unknown>, error?: string) => JobResultMessage): Promise<JobResultMessage> {
    const where = parseAddress(address);
    const seen = (this.d.store.get<FoundDevice[]>('lastScan') ?? []).find((f) => f.address === address);
    if (!deviceId || !where || !seen?.profileId) return result(false, {}, 'Nothing to commission at that address. Scan again first.');
    const c: DeviceConfig = deviceConfig.parse({
      id: deviceId,
      profileId: seen.profileId,
      type: seen.type,
      address,
      ...(where.kind === 'tcp' ? { modbus: { host: where.host, port: where.port, unitId: where.unitId } } : {}),
      ...(where.kind === 'rtu' ? { modbus: { path: where.path, unitId: where.unitId, ...this.busSettings(where.path) } } : {}),
      ...(where.kind === 'ocpp' ? { ocpp: { chargePointId: where.chargePointId } } : {}),
    });
    const r = this.addDevice(c, true);
    if (!r) return result(false, {}, 'The gateway can’t talk to this kind of device');
    let reading: TelemetryReading | null = null;
    for (let i = 0; i < 3 && !reading; i++) reading = await this.poll(r);
    const checks = this.checks(r, reading);
    this.startPolling(r);
    return result(checks.every((x) => x.pass), { checks });
  }

  private busSettings(path: string) {
    const bus = this.d.cfg.scan.rtu.find((b) => b.path === path);
    return bus ? { baudRate: bus.baudRate, parity: bus.parity } : {};
  }

  /** Live read, sign check and energy balance, with what the other devices read now. */
  checks(r: Running, reading: TelemetryReading | null): { name: string; pass: boolean }[] {
    const checks = [{ name: 'Live read', pass: reading !== null }];
    if (!reading) return checks;
    const type = r.cfg.type as DeviceType;
    const p = reading.p_kw;
    const others = [...this.devices.values()].filter((x) => x !== r && x.latest);
    const sum = (t: DeviceType) => others.filter((x) => x.cfg.type === t).reduce((s, x) => s + x.latest!.p_kw, 0) + (type === t ? p : 0);
    const meter = others.find((x) => x.cfg.type === 'meter') ?? (type === 'meter' ? r : null);
    // What's left for the building once every metered flow is counted: below zero, something
    // reads more than the site uses (a wrong sign, CT or scale).
    const building = meter ? buildingKw({ pv: sum('pv'), battery: sum('battery'), meter: sum('meter'), ev: sum('ev'), heatpump: sum('heatpump'), submeters: sum('submeter') }) : null;

    if (type === 'pv') checks.push({ name: 'Sign check: production positive', pass: p >= -0.05 });
    else if (type === 'battery') {
      const state = String(reading.state ?? '');
      checks.push({ name: 'Sign check: matches charging or discharging', pass: state === 'charging' ? p <= 0.05 : state === 'discharging' ? p >= -0.05 : true });
    } else if (isLoad(type)) checks.push({ name: 'Sign check: a load reads negative', pass: p <= 0.05 });
    else if (type === 'meter') checks.push({ name: 'Sign check: import positive', pass: building === null || building >= -0.5 });

    if (building !== null && meter) {
      const scale = Math.max(1, Math.abs(meter === r ? p : meter.latest!.p_kw));
      checks.push({ name: 'Energy balance within 5%', pass: building >= -0.05 * scale });
    }
    return checks;
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  start(): void {
    for (const r of this.devices.values()) this.startPolling(r);
    this.timers.push(
      setInterval(() => void this.flush(), 1000),
      setInterval(() => void this.publishStatus(), this.d.cfg.statusEveryMs),
      setInterval(() => void this.commands.tick(this.d.link.online()), 5000),
      setInterval(() => this.d.store.prune(this.now()), 3_600_000)
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    for (const id of [...this.devices.keys()]) this.stopDevice(id);
  }

  running(id: string): Running | undefined {
    return this.devices.get(id);
  }
}
