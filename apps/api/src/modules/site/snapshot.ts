import mongoose from 'mongoose';
import type { Redis } from 'ioredis';
import { Device, Interval15, Telemetry, type SiteDoc } from '@ecomanage/db';
import {
  batteryLive,
  billingPeriod,
  demandNow,
  intervalStart,
  siteFlows,
  type DeviceStatus,
  type DeviceType,
  type SiteSnapshot,
  type TelemetryReading,
} from '@ecomanage/shared';

// Redis keys written by ingest.
const latestKey = (deviceId: string) => `latest:${deviceId}`;
const gatewayKey = (siteId: string) => `gw:${siteId}`;
const GATEWAY_ONLINE_MS = 90_000; // the gateway reports every 30 s

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/**
 * Demand so far and projected for the current interval, from the meter's import counter at the
 * interval start (carried from the last reading before it) and now. Without a reading near the
 * start, the start counter is back-calculated from the first reading after it and marked estimated.
 */
const currentDemand = async (meterId: string, latest: TelemetryReading | null, tz: string): Promise<SiteSnapshot['demand']> => {
  if (!latest || latest.e_in_kwh === undefined) return null;
  const now = new Date(latest.ts);
  const start = intervalStart(now, tz, 15);
  const deviceId = new mongoose.Types.ObjectId(meterId);
  const before = await Telemetry.findOne({ 'meta.deviceId': deviceId, ts: { $lte: start, $gte: new Date(start.getTime() - 60_000) } })
    .sort({ ts: -1 })
    .select('ts p_kw e_in_kwh')
    .lean();
  let startKwh: number;
  let quality: 'ok' | 'estimated' = 'ok';
  if (before?.e_in_kwh != null) {
    startKwh = before.e_in_kwh + (Math.max(0, before.p_kw) * (start.getTime() - before.ts.getTime())) / 3_600_000;
  } else {
    const first =
      (await Telemetry.findOne({ 'meta.deviceId': deviceId, ts: { $gt: start } }).sort({ ts: 1 }).select('ts p_kw e_in_kwh').lean()) ?? null;
    const ref = first?.e_in_kwh != null ? { ts: first.ts, p: first.p_kw, e: first.e_in_kwh } : { ts: now, p: latest.p_kw, e: latest.e_in_kwh };
    startKwh = ref.e - (Math.max(0, ref.p) * (ref.ts.getTime() - start.getTime())) / 3_600_000;
    quality = ref.ts.getTime() - start.getTime() > 60_000 ? 'estimated' : 'ok';
  }
  if (latest.e_in_kwh < startKwh) {
    // The counter went backwards (meter replaced or reset): estimate from the current power.
    startKwh = latest.e_in_kwh - (Math.max(0, latest.p_kw) * (now.getTime() - start.getTime())) / 3_600_000;
    quality = 'estimated';
  }
  return { ...demandNow({ intervalStart: start, now, startKwh, nowKwh: latest.e_in_kwh, currentKw: latest.p_kw }), quality };
};

/** Everything the Home page needs on load (Data and Device Audit §5). */
export const buildSnapshot = async (site: SiteDoc, redis: Redis, now = new Date()): Promise<SiteSnapshot> => {
  const siteId = String(site._id);
  const devices = await Device.find({ siteId: site._id }).sort({ type: 1, name: 1 }).lean();
  const latestRaw = devices.length ? await redis.mget(...devices.map((d) => latestKey(String(d._id)))) : [];
  const withLatest = devices.map((d, i) => ({
    id: String(d._id),
    name: d.name,
    type: d.type as DeviceType,
    status: d.status as DeviceStatus,
    profileId: d.profileId ?? null,
    ratedKw: d.ratedKw ?? null,
    capacityKwh: d.capacityKwh ?? null,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    latest: parse<TelemetryReading>(latestRaw[i] ?? null),
  }));

  const meter = withLatest.find((d) => d.type === 'meter');
  const battery = withLatest.find((d) => d.type === 'battery');
  const period = billingPeriod(now, site.tz, site.billDay ?? 1);
  const [demand, peak, gwRaw] = await Promise.all([
    meter ? currentDemand(meter.id, meter.latest, site.tz) : Promise.resolve(null),
    Interval15.findOne({ siteId: site._id, start: { $gte: period.start, $lt: period.end } })
      .sort({ demandKw: -1 })
      .select('demandKw start')
      .lean(),
    redis.get(gatewayKey(siteId)),
  ]);
  const gw = parse<{ buffered: number; fw: string; receivedAt: string }>(gwRaw);

  return {
    site: {
      id: siteId,
      name: site.name,
      tz: site.tz,
      currency: site.currency ?? 'USD',
      demandCapKw: site.demandCapKw ?? null,
      billDay: site.billDay ?? 1,
    },
    now: now.toISOString(),
    devices: withLatest,
    flows: siteFlows(withLatest, now),
    battery: batteryLive(battery?.latest ?? null),
    demand,
    monthPeak: peak ? { kw: peak.demandKw, at: peak.start.toISOString() } : null,
    gateway: gw
      ? { online: now.getTime() - Date.parse(gw.receivedAt) <= GATEWAY_ONLINE_MS, buffered: gw.buffered, fw: gw.fw, receivedAt: gw.receivedAt }
      : null,
  };
};
