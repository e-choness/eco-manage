import mongoose from 'mongoose';
import { Telemetry } from '@ecomanage/db';
import { demandNow, intervalStart, type DemandNow, type TelemetryReading } from '@ecomanage/shared';

export type CurrentDemand = DemandNow & { quality: 'ok' | 'estimated' };

/**
 * Demand so far and projected for the current interval, from the meter's import counter at the
 * interval start (carried from the last reading before it) and now. Without a reading near the
 * start, the start counter is back-calculated from the first reading after it and marked estimated.
 */
export const currentDemand = async (meterId: string, latest: TelemetryReading | null, tz: string): Promise<CurrentDemand | null> => {
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
