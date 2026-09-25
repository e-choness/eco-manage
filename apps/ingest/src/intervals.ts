import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { Device, Interval15, Telemetry } from '@ecomanage/db';
import { round, type DeviceType, type Quality } from '@ecomanage/shared';

// 15-minute roll-up (plan P1-07, Data and Device Audit §5). Energy per device comes from the
// difference of its cumulative counters at the interval boundaries; the grid meter's import
// counter is the billing source, so demand = import kWh / 0.25 h. When counters are missing the
// device falls back to average power over the interval and the interval is marked estimated.

export const INTERVAL_MS = 15 * 60_000;
const BOUNDARY_TOLERANCE_MS = 60_000; // a counter reading counts for a boundary if within 60 s before it

/** Start of the 15-minute interval containing `at`. Real time-zone offsets are multiples of
 * 15 minutes, so the UTC quarter hour is also the local one. */
export const intervalOf = (at: Date): Date => new Date(Math.floor(at.getTime() / INTERVAL_MS) * INTERVAL_MS);

export interface IntervalValues {
  pv: number;
  used: number;
  batt: number;
  grid: number;
  export: number;
  bld: number;
  hp: number;
  ev: number;
  demandKw: number;
  quality: Quality;
}

interface Row {
  ts: Date;
  deviceId: string;
  p_kw: number;
  e_in_kwh?: number;
  e_out_kwh?: number;
}

interface Flow {
  inKwh: number;
  outKwh: number;
  estimated: boolean;
  missing: boolean;
}

// Counter value at a boundary: the last reading before it (within the tolerance), carried forward
// to the boundary with that reading's power so a reading a few seconds early doesn't lose energy.
const counterAt = (rows: Row[], boundary: number, field: 'e_in_kwh' | 'e_out_kwh', inWhenPositive: boolean): number | undefined => {
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rows[i].ts.getTime();
    if (t > boundary) continue;
    if (t < boundary - BOUNDARY_TOLERANCE_MS) return undefined;
    const v = rows[i][field];
    if (v === undefined) continue;
    const p = rows[i].p_kw;
    const inwardKw = inWhenPositive ? Math.max(0, p) : Math.max(0, -p);
    const outwardKw = inWhenPositive ? Math.max(0, -p) : Math.max(0, p);
    return v + ((field === 'e_in_kwh' ? inwardKw : outwardKw) * (boundary - t)) / 3_600_000;
  }
  return undefined;
};

/**
 * Energy through one device over [start, end), split into the direction its counters call "in"
 * and "out". Falls back to integrating average power when a counter is missing at a boundary.
 * `inWhenPositive`: for the grid meter, positive power is import ("in").
 */
const deviceFlow = (rows: Row[], start: number, end: number, inWhenPositive: boolean): Flow => {
  const inStart = counterAt(rows, start, 'e_in_kwh', inWhenPositive);
  const inEnd = counterAt(rows, end, 'e_in_kwh', inWhenPositive);
  const outStart = counterAt(rows, start, 'e_out_kwh', inWhenPositive);
  const outEnd = counterAt(rows, end, 'e_out_kwh', inWhenPositive);
  // A counter that went backwards (device replaced or reset) can't be used: fall back to power.
  const hasIn = inStart !== undefined && inEnd !== undefined && inEnd >= inStart;
  const hasOut = outStart !== undefined && outEnd !== undefined && outEnd >= outStart;
  const expectsIn = rows.some((r) => r.e_in_kwh !== undefined);
  const expectsOut = rows.some((r) => r.e_out_kwh !== undefined);
  const reset = (inStart !== undefined && inEnd !== undefined && inEnd < inStart) || (outStart !== undefined && outEnd !== undefined && outEnd < outStart);
  if (!reset && (hasIn || !expectsIn) && (hasOut || !expectsOut) && (hasIn || hasOut)) {
    return { inKwh: hasIn ? Math.max(0, inEnd! - inStart!) : 0, outKwh: hasOut ? Math.max(0, outEnd! - outStart!) : 0, estimated: false, missing: false };
  }
  const samples = rows.filter((r) => r.ts.getTime() >= start && r.ts.getTime() < end);
  if (samples.length === 0) return { inKwh: 0, outKwh: 0, estimated: true, missing: true };
  const avg = samples.reduce((s, r) => s + r.p_kw, 0) / samples.length;
  const kwh = (Math.abs(avg) * (end - start)) / 3_600_000;
  const inward = inWhenPositive ? avg > 0 : avg < 0;
  return { inKwh: inward ? kwh : 0, outKwh: inward ? 0 : kwh, estimated: true, missing: false };
};

/** Computes one interval for a site. `previous` supplies the building load when the meter is silent. */
export const computeInterval = async (
  siteId: string,
  start: Date,
  previous?: Pick<IntervalValues, 'bld'> | null
): Promise<IntervalValues | null> => {
  const s = start.getTime();
  const e = s + INTERVAL_MS;
  const devices = await Device.find({ siteId, type: { $nin: ['gateway'] } }).select('type').lean();
  if (devices.length === 0) return null;
  const typeOf = new Map(devices.map((d) => [String(d._id), d.type as DeviceType]));

  const raw = await Telemetry.find({
    'meta.siteId': new mongoose.Types.ObjectId(siteId),
    ts: { $gte: new Date(s - BOUNDARY_TOLERANCE_MS), $lte: new Date(e) },
  })
    .select('ts meta.deviceId p_kw e_in_kwh e_out_kwh')
    .sort({ ts: 1 })
    .lean();
  const byDevice = new Map<string, Row[]>();
  for (const r of raw) {
    const id = String(r.meta?.deviceId);
    const list = byDevice.get(id) ?? [];
    list.push({ ts: r.ts, deviceId: id, p_kw: r.p_kw, e_in_kwh: r.e_in_kwh ?? undefined, e_out_kwh: r.e_out_kwh ?? undefined });
    byDevice.set(id, list);
  }
  // Readings exactly at the end belong to the next interval; with none inside, there is nothing to roll up.
  if (!raw.some((r) => r.ts.getTime() >= s && r.ts.getTime() < e)) return null;

  let pv = 0,
    batt = 0,
    ev = 0,
    hp = 0,
    grid = 0,
    exported = 0,
    estimated = false,
    meterMissing = true;
  for (const [id, type] of typeOf) {
    if (type === 'submeter') continue; // part of the building load
    const flow = deviceFlow(byDevice.get(id) ?? [], s, e, type === 'meter');
    estimated ||= flow.estimated;
    switch (type) {
      case 'pv':
        pv += flow.outKwh;
        break;
      case 'battery':
        batt += flow.outKwh - flow.inKwh;
        break;
      case 'ev':
        ev += flow.inKwh;
        break;
      case 'heatpump':
        hp += flow.inKwh;
        break;
      case 'meter':
        if (!flow.missing) {
          meterMissing = false;
          grid += flow.inKwh;
          exported += flow.outKwh;
        }
        break;
    }
  }

  if (meterMissing) {
    // No meter data at all: assume the building used what it did in the previous interval and
    // let the grid cover the rest (the App v2 "estimated from inverter and battery data" case).
    const net = (previous?.bld ?? 0) + ev + hp - pv - batt;
    grid = Math.max(0, net);
    exported = Math.max(0, -net);
    estimated = true;
  }

  const bld = grid - exported + pv + batt - ev - hp;
  return {
    pv: round(pv, 3),
    used: round(Math.max(0, pv - exported), 3),
    batt: round(batt, 3),
    grid: round(grid, 3),
    export: round(exported, 3),
    bld: round(Math.max(0, bld), 3),
    hp: round(hp, 3),
    ev: round(ev, 3),
    demandKw: round((grid * 3_600_000) / INTERVAL_MS, 2),
    quality: estimated ? 'estimated' : 'ok',
  };
};

/** Computes and stores one interval (upsert on siteId + start). */
export const rollUp = async (siteId: string, start: Date): Promise<IntervalValues | null> => {
  const previous = await Interval15.findOne({ siteId, start: new Date(start.getTime() - INTERVAL_MS) }).select('bld').lean();
  const values = await computeInterval(siteId, start, previous);
  if (!values) return null;
  // Clearing costedAt tells the worker to price the interval again (P2-03).
  await Interval15.updateOne({ siteId, start }, { $set: { ...values, costedAt: null } }, { upsert: true });
  return values;
};

/**
 * Rolls up each interval once it has closed (plus a grace period for in-flight readings), catches
 * up after a restart, and recomputes intervals that received late (backfilled) readings.
 */
export class RollupScheduler {
  private readonly lastDone = new Map<string, number>();
  private readonly dirty = new Map<string, Set<number>>();

  constructor(
    private readonly log: Logger,
    private readonly graceMs = 30_000,
    private readonly maxCatchUp = 4 * 24 * 7 // one week of intervals
  ) {}

  /** A reading for an interval that has already closed: recompute it on the next tick. */
  markDirty(siteId: string, readingTs: Date, now = new Date()): void {
    const start = intervalOf(readingTs).getTime();
    if (start + INTERVAL_MS + this.graceMs > now.getTime()) return; // not rolled up yet anyway
    const set = this.dirty.get(siteId) ?? new Set<number>();
    set.add(start);
    this.dirty.set(siteId, set);
  }

  async tick(now = new Date()): Promise<number> {
    let done = 0;
    const lastClosed = intervalOf(new Date(now.getTime() - this.graceMs)).getTime() - INTERVAL_MS;
    const sites = (await Device.distinct('siteId')).map(String);
    for (const siteId of sites) {
      let from = this.lastDone.get(siteId);
      if (from === undefined) {
        // Resume after the last stored interval, or start from the site's first reading.
        const latest = await Interval15.findOne({ siteId }).sort({ start: -1 }).select('start').lean();
        const earliest = latest
          ? null
          : await Telemetry.findOne({ 'meta.siteId': new mongoose.Types.ObjectId(siteId) }).sort({ ts: 1 }).select('ts').lean();
        from = latest ? latest.start.getTime() : earliest ? intervalOf(earliest.ts).getTime() - INTERVAL_MS : lastClosed;
      }
      const first = Math.max(from + INTERVAL_MS, lastClosed - (this.maxCatchUp - 1) * INTERVAL_MS);
      for (let t = first; t <= lastClosed; t += INTERVAL_MS) {
        await rollUp(siteId, new Date(t));
        done++;
      }
      this.lastDone.set(siteId, Math.max(from, lastClosed));
    }
    for (const [siteId, starts] of this.dirty) {
      this.dirty.delete(siteId);
      for (const t of [...starts].sort((a, b) => a - b)) {
        await rollUp(siteId, new Date(t));
        // The next interval's meter-gap estimate depends on this one's building load.
        const next = await Interval15.findOne({ siteId, start: new Date(t + INTERVAL_MS) }).select('quality').lean();
        if (next?.quality === 'estimated') await rollUp(siteId, new Date(t + INTERVAL_MS));
        done++;
      }
    }
    if (done) this.log.debug({ intervals: done }, 'intervals rolled up');
    return done;
  }
}
