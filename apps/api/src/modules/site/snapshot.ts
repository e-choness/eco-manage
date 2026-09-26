import type { Redis } from 'ioredis';
import { Device, Interval15, type SiteDoc } from '@ecomanage/db';
import { currentDemand } from '@ecomanage/recs';
import {
  batteryLive,
  billingPeriod,
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
