import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { Command, Device, Site, Telemetry, type AlertDoc, type CommandDoc, type DeviceDoc, type SiteDoc } from '@ecomanage/db';
import { ALERT_LIMITS, alertKey, type AlertRuleId, type DemandNow, type TelemetryReading } from '@ecomanage/shared';
import type { SiteContext } from './checks';
import { bucketize, pvRatios, type PvPoint } from './pv';

// Loads what the checks need for one site: devices and their latest readings (Redis, written by
// ingest), gateway status, open commands, and 5-minute PV buckets for the last 3 hours.

const PV_WINDOW_MS = 3 * 3600_000;

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Inverter kWp from the site's solar arrays, or the inverter's rating when it has none. */
const kwpOf = (site: SiteDoc, inverters: DeviceDoc[]): Map<string, number> => {
  const kwp = new Map<string, number>();
  for (const a of site.pvArrays ?? []) if (a.inverterId && a.kwp) kwp.set(a.inverterId, (kwp.get(a.inverterId) ?? 0) + a.kwp);
  for (const d of inverters) if (!kwp.has(String(d._id)) && d.ratedKw) kwp.set(String(d._id), d.ratedKw);
  return kwp;
};

export const loadPvRatios = async (site: SiteDoc, inverters: DeviceDoc[], now: Date): Promise<Map<string, number[]>> => {
  if (inverters.length < 2) return new Map();
  const rows = await Telemetry.find({
    'meta.siteId': new mongoose.Types.ObjectId(String(site._id)),
    'meta.deviceId': { $in: inverters.map((d) => new mongoose.Types.ObjectId(String(d._id))) },
    ts: { $gte: new Date(now.getTime() - PV_WINDOW_MS), $lte: now },
  })
    .select('ts meta.deviceId p_kw')
    .lean<{ ts: Date; meta: { deviceId: unknown }; p_kw?: number }[]>();
  const points: PvPoint[] = rows.filter((r) => typeof r.p_kw === 'number').map((r) => ({ deviceId: String(r.meta.deviceId), ts: r.ts, kw: r.p_kw! }));
  return pvRatios(bucketize(points), kwpOf(site, inverters));
};

export interface LoadOptions {
  redis: Redis;
  now: Date;
  demand: DemandNow | null;
  live: Map<string, AlertDoc>;
  /** PV ratios change slowly; the caller may pass cached ones. */
  pvRatios?: Map<string, number[]>;
}

export const loadContext = async (siteId: string, { redis, now, demand, live, pvRatios: cachedPv }: LoadOptions): Promise<{ ctx: SiteContext; site: SiteDoc } | null> => {
  const site = await Site.findById(siteId).lean<SiteDoc>();
  if (!site) return null;
  const devices = await Device.find({ siteId }).lean<DeviceDoc[]>();
  const [latestRaw, gwRaw, commands] = await Promise.all([
    devices.length ? redis.mget(...devices.map((d) => `latest:${d._id}`)) : Promise.resolve([] as (string | null)[]),
    redis.get(`gw:${siteId}`),
    Command.find({
      siteId,
      $or: [{ status: 'sent' }, { status: 'failed', failedAt: { $gte: new Date(now.getTime() - ALERT_LIMITS.commandFailedWindowMs) } }],
    }).lean<CommandDoc[]>(),
  ]);
  const pv = cachedPv ?? (await loadPvRatios(site, devices.filter((d) => d.type === 'pv'), now));
  const gw = parse<{ buffered: number; oldestBufferedTs: string | null; receivedAt: string }>(gwRaw);

  const ctx: SiteContext = {
    now,
    demandCapKw: site.demandCapKw ?? null,
    devices: devices.map((d, i) => ({
      id: String(d._id),
      name: d.name,
      type: d.type,
      status: d.status,
      lastSeenAt: d.lastSeenAt ?? null,
      latest: parse<TelemetryReading>(latestRaw[i] ?? null),
    })),
    gateway: gw ? { buffered: gw.buffered ?? 0, oldestBufferedTs: gw.oldestBufferedTs ?? null, receivedAt: gw.receivedAt } : null,
    demand,
    commands: commands.map((c) => ({
      id: String(c._id),
      deviceId: c.deviceId,
      action: c.action,
      status: c.status,
      sentAt: c.sentAt ?? null,
      failedAt: c.failedAt ?? null,
      error: c.error ?? null,
    })),
    pvRatios: pv,
    active: new Set([...live.values()].map((a) => alertKey(a.ruleId as AlertRuleId, a.deviceId ?? null))),
  };
  return { ctx, site };
};
