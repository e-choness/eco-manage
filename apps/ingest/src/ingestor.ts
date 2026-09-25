import mongoose from 'mongoose';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Device, Telemetry } from '@ecomanage/db';
import { undeclaredFields } from '@ecomanage/profiles';
import {
  deviceStatusMessage,
  gatewayStatusMessage,
  isBackfill,
  parseTopic,
  readingsOf,
  telemetryMessage,
  type TelemetryReading,
} from '@ecomanage/shared';
import { DeviceCache } from './devices';

// Redis keys written by ingest (read by the API's snapshot and SSE):
export const keys = {
  latest: (deviceId: string) => `latest:${deviceId}`, // JSON of the newest reading
  seen: (deviceId: string, tsMs: number) => `seen:${deviceId}:${tsMs}`, // dedupe marker
  deviceStatus: (deviceId: string) => `status:${deviceId}`,
  gateway: (siteId: string) => `gw:${siteId}`,
};

// A 7-day buffer can be resent after a long outage; markers outlive it by a day.
const SEEN_TTL_S = 8 * 24 * 3600;

export interface IngestStats {
  received: number;
  stored: number;
  duplicates: number;
  rejected: Record<string, number>;
}

export interface IngestorOptions {
  redis: Redis;
  logger: Logger;
  flushMs?: number;
  batchSize?: number;
  devices?: DeviceCache;
  /** Called for each stored reading, so closed intervals that get late data are recomputed. */
  onReading?: (siteId: string, ts: Date, receivedAt: Date) => void;
}

type Row = { ts: Date; meta: { siteId: mongoose.Types.ObjectId; deviceId: mongoose.Types.ObjectId } } & Omit<TelemetryReading, 'ts'>;

/**
 * Turns MQTT messages into telemetry rows. Rows are buffered and written every `flushMs` or when
 * `batchSize` rows are waiting, whichever comes first (plan P1-06: 500 ms or 1000 rows).
 */
export class Ingestor {
  readonly stats: IngestStats = { received: 0, stored: 0, duplicates: 0, rejected: {} };
  private readonly redis: Redis;
  private readonly log: Logger;
  private readonly batchSize: number;
  private readonly devices: DeviceCache;
  private readonly onReading?: IngestorOptions['onReading'];
  private rows: Row[] = [];
  private lastSeen = new Map<string, Date>(); // deviceId -> received time, written on flush
  private latestTs = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(opts: IngestorOptions) {
    this.redis = opts.redis;
    this.log = opts.logger;
    this.batchSize = opts.batchSize ?? 1000;
    this.devices = opts.devices ?? new DeviceCache();
    this.onReading = opts.onReading;
    const flushMs = opts.flushMs ?? 500;
    if (flushMs > 0) {
      this.timer = setInterval(() => void this.flush(), flushMs);
      this.timer.unref();
    }
  }

  private reject(reason: string, detail: Record<string, unknown>): void {
    this.stats.rejected[reason] = (this.stats.rejected[reason] ?? 0) + 1;
    this.log.warn({ reason, ...detail }, 'telemetry rejected');
  }

  /** Handles one MQTT message. `receivedAt` decides whether readings count as backfill. */
  async handle(topic: string, raw: Buffer | string, receivedAt = new Date()): Promise<void> {
    const t = parseTopic(topic);
    if (!t) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return this.reject('not-json', { topic });
    }
    if (t.kind === 'telemetry') return this.handleTelemetry(t.siteId, t.deviceId, payload, receivedAt);
    if (t.kind === 'deviceStatus') {
      const s = deviceStatusMessage.safeParse(payload);
      if (s.success) await this.redis.set(keys.deviceStatus(t.deviceId), JSON.stringify(s.data));
      return;
    }
    if (t.kind === 'gatewayStatus') {
      const s = gatewayStatusMessage.safeParse(payload);
      if (s.success) await this.redis.set(keys.gateway(t.siteId), JSON.stringify({ ...s.data, receivedAt: receivedAt.toISOString() }));
    }
    // Command acks and job results are consumed by the API (P1-09, P3-04).
  }

  private async handleTelemetry(siteId: string, deviceId: string, payload: unknown, receivedAt: Date): Promise<void> {
    const parsed = telemetryMessage.safeParse(payload);
    if (!parsed.success) return this.reject('invalid-payload', { deviceId, issues: parsed.error.issues.slice(0, 3) });
    const readings = readingsOf(parsed.data);
    this.stats.received += readings.length;

    const device = await this.devices.get(deviceId);
    if (!device) return this.reject('unknown-device', { deviceId });
    if (device.siteId !== siteId) return this.reject('wrong-site', { deviceId, siteId });

    const valid = readings.filter((r) => {
      const extra = device.profile ? undeclaredFields(device.profile, r) : [];
      if (extra.length) this.reject('undeclared-fields', { deviceId, fields: extra });
      return extra.length === 0;
    });
    if (valid.length === 0) return;

    // Deduplicate on (deviceId, ts): a resent reading is dropped even across restarts.
    const pipeline = this.redis.pipeline();
    for (const r of valid) pipeline.set(keys.seen(deviceId, Date.parse(r.ts)), '1', 'EX', SEEN_TTL_S, 'NX');
    const results = (await pipeline.exec()) ?? [];
    const fresh = valid.filter((_, i) => results[i]?.[1] === 'OK');
    this.stats.duplicates += valid.length - fresh.length;
    if (fresh.length === 0) return;

    const meta = { siteId: new mongoose.Types.ObjectId(siteId), deviceId: new mongoose.Types.ObjectId(deviceId) };
    for (const r of fresh) {
      const ts = new Date(r.ts);
      const q = r.q === 'ok' && isBackfill(ts, receivedAt) ? 'backfilled' : r.q;
      const { ts: _ts, ...fields } = r;
      this.rows.push({ ...fields, ts, meta, q });
      this.onReading?.(siteId, ts, receivedAt);
    }
    this.lastSeen.set(deviceId, receivedAt);
    await this.updateLatest(deviceId, fresh);
    if (this.rows.length >= this.batchSize) await this.flush();
  }

  private async updateLatest(deviceId: string, readings: TelemetryReading[]): Promise<void> {
    const newest = readings.reduce((a, b) => (Date.parse(b.ts) > Date.parse(a.ts) ? b : a));
    const newestMs = Date.parse(newest.ts);
    if (newestMs <= (this.latestTs.get(deviceId) ?? -Infinity)) return;
    this.latestTs.set(deviceId, newestMs);
    await this.redis.set(keys.latest(deviceId), JSON.stringify(newest));
  }

  /** Writes waiting rows and last-seen times. Flushes run one after another. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.write()).catch((err: Error) => this.log.error({ err: err.message }, 'flush failed'));
    return this.flushing;
  }

  private async write(): Promise<void> {
    const rows = this.rows;
    const seen = this.lastSeen;
    this.rows = [];
    this.lastSeen = new Map();
    if (rows.length) {
      await Telemetry.insertMany(rows, { ordered: false, lean: true });
      this.stats.stored += rows.length;
    }
    if (seen.size) {
      await Device.bulkWrite(
        [...seen].map(([id, at]) => ({
          updateOne: {
            filter: { _id: id },
            update: [
              {
                $set: {
                  lastSeenAt: { $max: ['$lastSeenAt', at] },
                  // Reporting again brings a stale or offline device back; pending stays pending.
                  status: { $cond: [{ $in: ['$status', ['stale', 'offline']] }, 'live', '$status'] },
                },
              },
            ],
          },
        }))
      );
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
