import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Device, Site, recordAudit, type DeviceDoc, type SiteDoc } from '@ecomanage/db';
import type { BatteryPatch, GatewayView, PvArraysInput, SitePatch, SiteSettings } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import type { GatewayLink } from '../../lib/gatewayLink';

// Settings → Site (plan P2-06): site details, solar arrays, battery and the gateway card.

const GATEWAY_ONLINE_MS = 90_000; // the gateway reports every 30 s
const GATEWAY_BUFFER_DAYS = 7;

const fail = (status: number, message: string, details?: unknown) =>
  new HttpError(status, { error: { code: status, message, ...(details ? { details } : {}) } });

const batteryOf = (siteId: SiteDoc['_id']) => Device.findOne({ siteId, type: 'battery' }).sort({ createdAt: 1 }).lean<DeviceDoc>();

const toSettings = (site: SiteDoc, battery: DeviceDoc | null): SiteSettings => ({
  id: String(site._id),
  name: site.name,
  address: site.address ?? '',
  tz: site.tz,
  lat: site.lat ?? null,
  lon: site.lon ?? null,
  currency: site.currency ?? 'USD',
  billDay: site.billDay ?? 1,
  demandCapKw: site.demandCapKw ?? null,
  pvArrays: (site.pvArrays ?? []).map((a) => ({
    id: a.id!,
    name: a.name!,
    inverterId: a.inverterId!,
    kwp: a.kwp!,
    tiltDeg: a.tiltDeg!,
    azimuthDeg: a.azimuthDeg!,
  })),
  battery: battery
    ? { deviceId: String(battery._id), usableKwh: battery.capacityKwh ?? null, maxKw: battery.ratedKw ?? null, floorPct: site.batteryFloorPct ?? 10 }
    : null,
});

const reload = async (siteId: SiteDoc['_id']) => {
  const [site, battery] = await Promise.all([Site.findById(siteId).lean<SiteDoc>(), batteryOf(siteId)]);
  return toSettings(site!, battery);
};

export const getSettings = async (site: SiteDoc): Promise<SiteSettings> => toSettings(site, await batteryOf(site._id));

/** Only the fields that actually change are written and audited. */
const changes = <T extends object>(current: Record<string, unknown>, patch: T) =>
  Object.fromEntries(Object.entries(patch).filter(([k, v]) => current[k] !== v)) as Partial<T>;

export const updateSite = async (site: SiteDoc, userId: string, patch: SitePatch): Promise<SiteSettings> => {
  const diff = changes(site as unknown as Record<string, unknown>, patch);
  if (Object.keys(diff).length) {
    await Site.updateOne({ _id: site._id }, { $set: diff });
    const before = Object.fromEntries(Object.keys(diff).map((k) => [k, (site as unknown as Record<string, unknown>)[k] ?? null]));
    await recordAudit({ siteId: site._id, userId, action: 'site.update', target: `site:${site._id}`, before, after: diff });
  }
  return reload(site._id);
};

/** Replaces the solar arrays table. Each array must belong to one of the site's inverters. */
export const replacePvArrays = async (site: SiteDoc, userId: string, input: PvArraysInput): Promise<SiteSettings> => {
  const inverters = new Set(
    (await Device.find({ siteId: site._id, type: 'pv' }).select('_id').lean<{ _id: unknown }[]>()).map((d) => String(d._id))
  );
  const issues = input.flatMap((a, i) => (inverters.has(a.inverterId) ? [] : [{ index: i, field: 'inverterId', message: `${a.name}: not an inverter of this site` }]));
  if (issues.length) throw fail(422, 'Every array needs one of the site’s inverters', { issues });
  const pvArrays = input.map((a) => ({ ...a, id: a.id ?? randomUUID().slice(0, 8) }));
  await Site.updateOne({ _id: site._id }, { $set: { pvArrays } });
  await recordAudit({ siteId: site._id, userId, action: 'site.pv-arrays', target: `site:${site._id}`, before: site.pvArrays ?? [], after: pvArrays });
  return reload(site._id);
};

/**
 * Sends the gateway its config; on failure the site is marked pending and the config is sent
 * again when the API reconnects to the broker.
 */
export const pushGatewayConfig = async (siteId: SiteDoc['_id'], floorPct: number, gateway?: GatewayLink): Promise<boolean> => {
  const sent = gateway ? await gateway.sendConfig(String(siteId), { batteryFloorPct: floorPct }) : false;
  await Site.updateOne({ _id: siteId }, { $set: { gatewayConfigPending: !sent } });
  return sent;
};

export const syncPendingGatewayConfigs = async (gateway: GatewayLink): Promise<number> => {
  let sent = 0;
  for (const site of await Site.find({ gatewayConfigPending: true }).lean<SiteDoc[]>())
    if (await pushGatewayConfig(site._id, site.batteryFloorPct ?? 10, gateway)) sent++;
  return sent;
};

export const updateBattery = async (site: SiteDoc, userId: string, patch: BatteryPatch, gateway?: GatewayLink) => {
  const battery = await batteryOf(site._id);
  if (!battery) throw fail(404, 'This site has no battery');
  const before = { usableKwh: battery.capacityKwh ?? null, maxKw: battery.ratedKw ?? null, floorPct: site.batteryFloorPct ?? 10 };
  const device: Record<string, number> = {};
  if (patch.usableKwh !== undefined) device.capacityKwh = patch.usableKwh;
  if (patch.maxKw !== undefined) device.ratedKw = patch.maxKw;
  if (Object.keys(device).length) await Device.updateOne({ _id: battery._id }, { $set: device });
  const floorChanged = patch.floorPct !== undefined && patch.floorPct !== before.floorPct;
  if (floorChanged) await Site.updateOne({ _id: site._id }, { $set: { batteryFloorPct: patch.floorPct } });
  await recordAudit({ siteId: site._id, userId, action: 'site.battery', target: `device:${battery._id}`, before, after: { ...before, ...patch } });
  // The gateway enforces the floor itself, so it must hear about a change.
  const gatewaySync = floorChanged ? ((await pushGatewayConfig(site._id, patch.floorPct!, gateway)) ? 'sent' : 'pending') : 'unchanged';
  return { settings: await reload(site._id), gatewaySync };
};

export const gatewayStatus = async (site: SiteDoc, redis?: Redis, now = new Date()): Promise<GatewayView> => {
  const raw = redis ? await redis.get(`gw:${site._id}`) : null;
  let gw: { fw?: string; uptimeS?: number; buffered?: number; oldestBufferedTs?: string | null; clockOffsetMs?: number; receivedAt?: string } | null = null;
  try {
    gw = raw ? JSON.parse(raw) : null;
  } catch {
    gw = null;
  }
  return {
    id: site.gatewayId ?? null,
    online: !!gw?.receivedAt && now.getTime() - Date.parse(gw.receivedAt) <= GATEWAY_ONLINE_MS,
    fw: gw?.fw ?? null,
    uptimeS: gw?.uptimeS ?? null,
    buffered: gw?.buffered ?? null,
    oldestBufferedTs: gw?.oldestBufferedTs ?? null,
    clockOffsetMs: gw?.clockOffsetMs ?? null,
    lastSeenAt: gw?.receivedAt ?? null,
    bufferDays: GATEWAY_BUFFER_DAYS,
    batteryFloorPct: site.batteryFloorPct ?? null,
    configPending: !!site.gatewayConfigPending,
  };
};
