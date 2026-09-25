import { z } from 'zod';
import {
  commandMessage,
  gatewayConfigMessage,
  jobMessage,
  parseTopic,
  topics,
  type DemoDevice,
  type TelemetryReading,
} from '@ecomanage/shared';
import { checkWriteParams, getProfile } from '@ecomanage/profiles';
import type { SiteEngine } from './engine/site';

// Behaves like the edge gateway (spec §4): publishes readings per device, keeps them while the
// cloud connection is down and resends them in order, executes commands with expiry and profile
// limits, and answers scan / commission / restart jobs. Faults are injected here (spec §7).

export type Publish = (topic: string, payload: unknown, options?: { retain?: boolean }) => void;

export const FAULT_TYPES = ['device-offline', 'meter-gap', 'gateway-offline', 'command-rejected', 'output-drop'] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export const faultInput = z.object({
  type: z.enum(FAULT_TYPES),
  device: z.string().optional(), // device key, e.g. "invA", "ev3"
  minutes: z.number().positive().max(7 * 24 * 60).optional(), // simulated minutes; omit = until cleared
});
export type FaultInput = z.infer<typeof faultInput>;

interface ActiveFault extends FaultInput {
  id: number;
  until: number | null; // simulated epoch ms
}

// The sub-meter the scan finds (App v2 Devices → Scan): kitchen circuits, RS-485 id 7.
export const SCAN_FINDS = {
  address: 'RS-485 · id 7',
  modelCode: 'CT3-100',
  profileId: 'ct-meter-3ph@2',
  type: 'submeter',
  name: 'Sub-meter · kitchen',
} as const;

const BATCH_MAX = 500;
const FLUSH_MAX = 500; // one batch per tick
const FW = '1.4.2';

export class Gateway {
  private faults: ActiveFault[] = [];
  private nextFaultId = 1;
  private readonly buffer: { deviceKey: string; reading: TelemetryReading }[] = [];
  private readonly lastPublished = new Map<string, number>();
  private readonly startedAt: number;
  private wasOffline = false;

  constructor(
    private readonly engine: SiteEngine,
    private readonly siteId: string,
    private readonly publish: Publish,
    private readonly publishEveryMs: () => number = () => 5000
  ) {
    this.startedAt = engine.now.getTime();
  }

  // ---- faults ------------------------------------------------------------------------------------

  addFault(input: FaultInput): ActiveFault {
    const fault: ActiveFault = {
      ...input,
      id: this.nextFaultId++,
      until: input.minutes ? this.engine.now.getTime() + input.minutes * 60_000 : null,
    };
    if (fault.type === 'output-drop') this.engine.setOutputFactor(input.device ?? 'invB', 0.8);
    this.faults.push(fault);
    return fault;
  }

  clearFaults(filter?: (f: ActiveFault) => boolean): void {
    const [removed, kept] = this.faults.reduce<[ActiveFault[], ActiveFault[]]>(
      (acc, f) => ((filter ? filter(f) : true) ? acc[0].push(f) : acc[1].push(f), acc),
      [[], []]
    );
    this.faults = kept;
    for (const f of removed) {
      if (f.type === 'output-drop') this.engine.setOutputFactor(f.device ?? 'invB', 1);
    }
  }

  activeFaults(): ActiveFault[] {
    return [...this.faults];
  }

  private expireFaults(): void {
    const now = this.engine.now.getTime();
    this.clearFaults((f) => f.until !== null && now >= f.until);
  }

  private has(type: FaultType, device?: string): boolean {
    return this.faults.some((f) => f.type === type && (device === undefined || f.device === device));
  }

  isOnline(): boolean {
    return !this.has('gateway-offline');
  }

  // ---- publishing --------------------------------------------------------------------------------

  private silent(key: string): boolean {
    return this.has('device-offline', key) || (this.engine.devices.get(key)?.type === 'meter' && this.has('meter-gap'));
  }

  /** Publishes a reading for every device that is due, or buffers it while offline. */
  tick(): void {
    this.expireFaults();
    if (this.isOnline() && this.wasOffline) {
      // Back online: say so (with the backlog) before anything else, like a real gateway.
      this.wasOffline = false;
      this.publishGatewayStatus();
    }
    if (!this.isOnline()) this.wasOffline = true;
    // Resend what was kept first, a batch per tick; new readings queue behind it (FIFO), so
    // everything arrives in time order.
    if (this.isOnline() && this.buffer.length > 0) this.flush();
    const now = this.engine.now.getTime();
    for (const d of this.engine.devices.values()) {
      if (d.type === 'gateway' || this.silent(d.key)) continue;
      if (now - (this.lastPublished.get(d.key) ?? -Infinity) < this.publishEveryMs()) continue;
      const reading = this.engine.reading(d.key);
      if (!reading) continue;
      this.lastPublished.set(d.key, now);
      if (this.isOnline() && this.buffer.length === 0) this.publish(topics.telemetry(this.siteId, d.id), reading);
      else this.buffer.push({ deviceKey: d.key, reading });
    }
  }

  /**
   * Resends buffered readings in order, grouped per device in batches. Like a real gateway on a
   * slow uplink it drains one batch (FLUSH_MAX readings) per tick, so a long outage takes a while to
   * catch up and the status messages meanwhile show the backlog (the gateway-buffer alert).
   */
  private flush(): void {
    const byDevice = new Map<string, TelemetryReading[]>();
    for (const { deviceKey, reading } of this.buffer.splice(0, FLUSH_MAX)) {
      const list = byDevice.get(deviceKey) ?? [];
      list.push(reading);
      byDevice.set(deviceKey, list);
    }
    for (const [key, readings] of byDevice) {
      const id = this.engine.devices.get(key)!.id;
      for (let i = 0; i < readings.length; i += BATCH_MAX) {
        this.publish(topics.telemetry(this.siteId, id), { items: readings.slice(i, i + BATCH_MAX) });
      }
    }
  }

  bufferedCount(): number {
    return this.buffer.length;
  }

  publishGatewayStatus(): void {
    if (!this.isOnline()) return;
    const oldest = this.buffer[0]?.reading.ts ?? null;
    this.publish(
      topics.gatewayStatus(this.siteId),
      {
        ts: this.engine.now.toISOString(),
        fw: FW,
        uptimeS: Math.round((this.engine.now.getTime() - this.startedAt) / 1000),
        buffered: this.buffer.length,
        oldestBufferedTs: oldest,
        clockOffsetMs: 0,
      },
      { retain: true }
    );
  }

  // ---- commands and jobs ----------------------------------------------------------------------------

  private deviceById(id: string): DemoDevice | undefined {
    return [...this.engine.devices.values()].find((d) => d.id === id);
  }

  private ack(commandId: string, ok: boolean, error?: string): void {
    this.publish(topics.commandAck(this.siteId, commandId), { ok, ts: this.engine.now.toISOString(), ...(error ? { error } : {}) });
  }

  /** Handles a message the gateway is subscribed to (commands, jobs and config for its site). */
  handleMessage(topic: string, payload: unknown): void {
    if (this.handleConfig(topic, payload)) return;
    const t = parseTopic(topic);
    if (!t || t.siteId !== this.siteId || !this.isOnline()) return;
    if (t.kind === 'command') this.handleCommand(t.commandId, payload);
    if (t.kind === 'job') this.handleJob(t.jobId, payload);
  }

  /**
   * Retained config from the cloud. Applied even while the simulated uplink is down: a real
   * gateway would get the retained message as soon as it reconnects.
   */
  handleConfig(topic: string, payload: unknown): boolean {
    const t = parseTopic(topic);
    if (t?.kind !== 'gatewayConfig' || t.siteId !== this.siteId) return false;
    const parsed = gatewayConfigMessage.safeParse(payload);
    if (parsed.success) this.engine.setFloor(parsed.data.batteryFloorPct);
    return parsed.success;
  }

  private handleCommand(commandId: string, payload: unknown): void {
    const parsed = commandMessage.safeParse(payload);
    if (!parsed.success) return this.ack(commandId, false, 'malformed command');
    const cmd = parsed.data;
    if (Date.parse(cmd.expiresAt) <= this.engine.now.getTime()) return this.ack(commandId, false, 'expired');
    const device = this.deviceById(cmd.deviceId);
    if (!device) return this.ack(commandId, false, 'unknown device');
    // Each command-rejected fault makes the device refuse one command.
    const rejection = this.faults.find((f) => f.type === 'command-rejected');
    if (rejection) {
      this.clearFaults((f) => f.id === rejection.id);
      return this.ack(commandId, false, 'rejected by device');
    }
    if (cmd.action !== 'revert') {
      const action = getProfile(device.profileId)?.write[cmd.action];
      if (!action) return this.ack(commandId, false, `action ${cmd.action} not supported by ${device.profileId}`);
      const problems = checkWriteParams(action, cmd.params);
      if (problems.length) return this.ack(commandId, false, problems.join('; '));
    }
    // A reset or restart brings a silent device back, which is how an alert's Fix button works.
    if (cmd.action === 'reset' || cmd.action === 'restart') this.clearFaults((f) => f.type === 'device-offline' && f.device === device.key);
    const result = this.engine.apply(device.key, cmd.action, cmd.params);
    this.ack(commandId, result.ok, result.error);
  }

  private handleJob(jobId: string, payload: unknown): void {
    const parsed = jobMessage.safeParse(payload);
    const result = (ok: boolean, data: Record<string, unknown>, error?: string) =>
      this.publish(topics.jobResult(this.siteId, jobId), { ok, ts: this.engine.now.toISOString(), data, ...(error ? { error } : {}) });
    if (!parsed.success) return result(false, {}, 'malformed job');
    const { type, params } = parsed.data;
    if (type === 'scan') {
      const known = [...this.engine.devices.values()].some((d) => d.address === SCAN_FINDS.address);
      return result(true, { found: known ? [] : [SCAN_FINDS] });
    }
    if (type === 'restart') return result(true, {});
    // commission: the cloud has created the device record and passes its id
    const deviceId = String(params.deviceId ?? '');
    const address = String(params.address ?? '');
    if (!deviceId || address !== SCAN_FINDS.address) return result(false, {}, 'nothing to commission at that address');
    this.engine.addSubmeter({
      id: deviceId,
      key: 'sub',
      type: 'submeter',
      name: SCAN_FINDS.name,
      profileId: SCAN_FINDS.profileId,
      address,
      role: 'submeter',
      ratedKw: null,
      capacityKwh: null,
    });
    const reading = this.engine.reading('sub');
    const subKw = Math.abs(reading?.p_kw ?? 0);
    // Checks from the Data and Device Audit §4 step 5. The sub-meter measures a load, so it reads
    // import-positive on its own terminals and negative in the site convention.
    const checks = [
      { name: 'Live read', pass: reading !== null },
      { name: 'Sign check: import positive', pass: (reading?.p_kw ?? 1) < 0 },
      { name: 'Energy balance within 5%', pass: subKw <= this.engine.buildingKw() * 1.05 },
    ];
    return result(checks.every((c) => c.pass), { checks });
  }
}
