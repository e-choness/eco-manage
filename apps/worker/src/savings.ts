import { Interval15, Recommendation, Site, Tariff, type RecommendationDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import { billingPeriod, siteDate, siteDateStart, tariffFromDoc, tariffOn } from '@ecomanage/shared';

// The saving a carried-out recommendation actually made (plan P3-04: "measure the actual saving
// the next day"), from the meter's intervals once the day is over.
//
// Peak shaving: the battery's own discharge is in the intervals, so the site's demand without it
// is (grid − export + battery discharge) × 4. The saving is the billing period's demand charge
// without the discharge minus with it. Other rules have no clean counterfactual in the data yet,
// so they keep only their expected saving.

const MEASURED = new Set(['peak-shaving']);
const r1 = (x: number) => Math.round(x * 10) / 10;
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

type Row = { start: Date; grid: number; export: number; batt: number; demandKw: number };

export const measurePeakShaving = (window: { start: Date; end: Date }, rows: Row[], demandRateCents: number) => {
  const inWindow = (r: Row) => r.start >= window.start && r.start < window.end;
  const others = Math.max(0, ...rows.filter((r) => !inWindow(r)).map((r) => r.demandKw));
  const withBattery = Math.max(0, ...rows.filter(inWindow).map((r) => r.demandKw));
  const without = Math.max(0, ...rows.filter(inWindow).map((r) => Math.max(0, r.grid - r.export + Math.max(0, r.batt)) * 4));
  const peakWithout = r1(Math.max(others, without));
  const peakWith = r1(Math.max(others, withBattery));
  const kw = r1(Math.max(0, peakWithout - peakWith));
  const cents = Math.round(kw * demandRateCents);
  return {
    cents,
    calc: `period peak ${peakWithout} kW without the battery − ${peakWith} kW with it = ${kw} kW × ${money(demandRateCents)}/kW = ${money(cents)}`,
  };
};

/** Measures recommendations whose window ended before today (site time). Returns how many. */
export const measureSavings = async (now = new Date()): Promise<number> => {
  const due = await Recommendation.find({ status: { $in: ['verified', 'reverted', 'cancelled'] }, measuredAt: null, 'window.end': { $lte: now } }).lean<RecommendationDoc[]>();
  let measured = 0;
  for (const rec of due) {
    const site = await Site.findById(rec.siteId).lean<SiteDoc>();
    if (!site) continue;
    const today = siteDateStart(siteDate(now, site.tz), site.tz);
    if (rec.window.end! > today) continue; // the day isn't over yet
    if (!MEASURED.has(rec.ruleId) || (rec.status === 'cancelled' && !rec.commandId)) {
      await Recommendation.updateOne({ _id: rec._id }, { $set: { measuredAt: now } });
      continue;
    }
    const period = billingPeriod(rec.window.start!, site.tz, site.billDay ?? 1);
    const [rows, tariffs] = await Promise.all([
      Interval15.find({ siteId: site._id, start: { $gte: period.start, $lt: period.end } }).select('start grid export batt demandKw').lean<Row[]>(),
      Tariff.find({ siteId: site._id }).lean<TariffDoc[]>(),
    ]);
    const tariff = tariffOn(tariffs.map(tariffFromDoc), siteDate(rec.window.start!, site.tz));
    const { cents, calc } = measurePeakShaving({ start: rec.window.start!, end: rec.window.end! }, rows, tariff?.demandRateCents ?? 0);
    await Recommendation.updateOne({ _id: rec._id }, { $set: { actualSavingCents: cents, actualCalc: calc, measuredAt: now } });
    measured++;
  }
  return measured;
};
