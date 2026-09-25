import mongoose, { isValidObjectId } from 'mongoose';
import type { Redis } from 'ioredis';
import { Device, Telemetry, recordAudit, type DeviceDoc } from '@ecomanage/db';
import { getProfile } from '@ecomanage/profiles';
import {
  MAX_POINTS,
  TELEMETRY_RESOLUTIONS,
  type CreateDeviceBody,
  type DeviceDetail,
  type DeviceView,
  type PatchDeviceBody,
  type TelemetryQuery,
  type TelemetryReading,
  type TelemetryResolution,
  type TelemetrySeries,
} from '@ecomanage/shared';
import User from '../auth/model';

// v2 devices (plan P1-09). Everything is scoped to the caller's site; writes are audited.

const latestKey = (deviceId: string) => `latest:${deviceId}`;

const parseLatest = (raw: string | null | undefined): TelemetryReading | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelemetryReading;
  } catch {
    return null;
  }
};

const toView = (d: DeviceDoc, latest: TelemetryReading | null): DeviceView => ({
  id: String(d._id),
  siteId: String(d.siteId),
  type: d.type as DeviceView['type'],
  name: d.name,
  profileId: d.profileId ?? null,
  address: d.address ?? '',
  role: d.role ?? '',
  status: d.status as DeviceView['status'],
  ratedKw: d.ratedKw ?? null,
  capacityKwh: d.capacityKwh ?? null,
  lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
  commissionedAt: d.commissionedAt ? d.commissionedAt.toISOString() : null,
  quality: latest?.q ?? null,
  latest,
});

const findOwn = (siteId: string, id: string) =>
  isValidObjectId(id) ? Device.findOne({ _id: id, siteId }).lean<DeviceDoc>() : Promise.resolve(null);

export const listDevices = async (redis: Redis, siteId: string): Promise<DeviceView[]> => {
  const devices = await Device.find({ siteId }).sort({ type: 1, name: 1 }).lean<DeviceDoc[]>();
  const latest = devices.length ? await redis.mget(...devices.map((d) => latestKey(String(d._id)))) : [];
  return devices.map((d, i) => toView(d, parseLatest(latest[i])));
};

export const getDevice = async (redis: Redis, siteId: string, id: string): Promise<DeviceDetail | null> => {
  const d = await findOwn(siteId, id);
  if (!d) return null;
  const [latest, installer] = await Promise.all([
    redis.get(latestKey(id)),
    d.commissionedBy ? User.findById(d.commissionedBy).select('name email').lean() : Promise.resolve(null),
  ]);
  const p = d.profileId ? getProfile(d.profileId) : undefined;
  return {
    ...toView(d, parseLatest(latest)),
    commissionedBy: installer ? { id: String(installer._id), name: installer.name || installer.email } : null,
    profile: p
      ? { id: p.id, vendor: p.vendor, model: p.model, protocol: p.protocol, pollMs: p.pollMs, writeActions: Object.keys(p.write), fixes: p.fixes.map((f) => f.label) }
      : null,
  };
};

export type ProfileCheck = 'ok' | 'unknown-profile' | 'profile-type-mismatch';

/** A profile, if given, must exist and support the device type. */
export const checkProfile = (profileId: string | null | undefined, type: string): ProfileCheck => {
  if (!profileId) return 'ok';
  const p = getProfile(profileId);
  if (!p) return 'unknown-profile';
  return (p.deviceTypes as string[]).includes(type) ? 'ok' : 'profile-type-mismatch';
};

export type WriteResult = { ok: true; device: DeviceView } | { ok: false; reason: 'not-found' | Exclude<ProfileCheck, 'ok'> };

export const createDevice = async (siteId: string, userId: string, body: CreateDeviceBody): Promise<WriteResult> => {
  const check = checkProfile(body.profileId, body.type);
  if (check !== 'ok') return { ok: false, reason: check };
  const doc = await Device.create({ ...body, siteId, status: 'pending' });
  const device = toView(doc.toObject() as DeviceDoc, null);
  await recordAudit({ siteId, userId, action: 'device.create', target: `device:${device.id}`, after: device });
  return { ok: true, device };
};

export const updateDevice = async (siteId: string, userId: string, id: string, patch: PatchDeviceBody): Promise<WriteResult> => {
  const before = await findOwn(siteId, id);
  if (!before) return { ok: false, reason: 'not-found' };
  const check = checkProfile(patch.profileId, before.type);
  if (check !== 'ok') return { ok: false, reason: check };
  const after = await Device.findOneAndUpdate({ _id: id, siteId }, { $set: patch }, { new: true }).lean<DeviceDoc>();
  if (!after) return { ok: false, reason: 'not-found' };
  const view = toView(after, null);
  await recordAudit({ siteId, userId, action: 'device.update', target: `device:${id}`, before: toView(before, null), after: view });
  return { ok: true, device: view };
};

export const deleteDevice = async (siteId: string, userId: string, id: string): Promise<boolean> => {
  const before = await findOwn(siteId, id);
  if (!before) return false;
  await Device.deleteOne({ _id: id, siteId });
  // Telemetry is kept: it expires with the 13-month time-series TTL.
  await recordAudit({ siteId, userId, action: 'device.delete', target: `device:${id}`, before: toView(before, null) });
  return true;
};

// ---- telemetry series ---------------------------------------------------------------------------

const BIN_MS: Record<Exclude<TelemetryResolution, 'raw'>, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, h: 3_600_000 };
const TRUNC: Record<Exclude<TelemetryResolution, 'raw'>, { unit: 'minute' | 'hour'; binSize: number }> = {
  '1m': { unit: 'minute', binSize: 1 },
  '5m': { unit: 'minute', binSize: 5 },
  '15m': { unit: 'minute', binSize: 15 },
  h: { unit: 'hour', binSize: 1 },
};

export type SeriesResult = TelemetrySeries | 'not-found' | 'range-invalid' | 'range-too-long';

/**
 * A device's power over a time range, averaged per bucket. When the requested resolution would
 * give more than 400 points, the next coarser one is used and `capped` is set (plan §3.2).
 */
export const telemetrySeries = async (siteId: string, id: string, q: TelemetryQuery, now = new Date()): Promise<SeriesResult> => {
  if (!(await findOwn(siteId, id))) return 'not-found';
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * 3_600_000);
  if (from >= to) return 'range-invalid';
  const match = { 'meta.deviceId': new mongoose.Types.ObjectId(id), ts: { $gte: from, $lt: to } };
  const span = to.getTime() - from.getTime();

  const order = TELEMETRY_RESOLUTIONS.slice(TELEMETRY_RESOLUTIONS.indexOf(q.res));
  let res: TelemetryResolution | undefined;
  for (const r of order) {
    const points = r === 'raw' ? await Telemetry.countDocuments(match) : Math.ceil(span / BIN_MS[r]);
    if (points <= MAX_POINTS) {
      res = r;
      break;
    }
  }
  if (!res) return 'range-too-long';
  const capped = res !== q.res;

  if (res === 'raw') {
    const rows = await Telemetry.find(match).sort({ ts: 1 }).select('ts p_kw q').lean();
    return {
      res,
      capped,
      points: rows.map((r) => ({ ts: r.ts.toISOString(), p_kw: r.p_kw, min_kw: r.p_kw, max_kw: r.p_kw, n: 1, estimated: r.q === 'estimated' })),
    };
  }

  const rows = await Telemetry.aggregate<{ _id: Date; avg: number; min: number; max: number; n: number; est: number }>([
    { $match: match },
    {
      $group: {
        _id: { $dateTrunc: { date: '$ts', ...TRUNC[res], timezone: 'UTC' } },
        avg: { $avg: '$p_kw' },
        min: { $min: '$p_kw' },
        max: { $max: '$p_kw' },
        n: { $sum: 1 },
        est: { $max: { $cond: [{ $eq: ['$q', 'estimated'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    res,
    capped,
    points: rows.map((r) => ({ ts: r._id.toISOString(), p_kw: r3(r.avg), min_kw: r3(r.min), max_kw: r3(r.max), n: r.n, estimated: r.est === 1 })),
  };
};
