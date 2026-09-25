import type { Types } from 'mongoose';
import { Bill, Interval15, Site, Tariff, type BillDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import {
  billingPeriod,
  demandChargeCents,
  periodPeak,
  siteDate,
  tariffOn,
  touSplit,
  type BillingPeriod,
  type Tariff as TariffShape,
} from '@ecomanage/shared';

// Interval costs and bills (plan P2-03):
//   bill = Σ interval energy × the tariff version valid on each day
//        + highest demand × demand rate + fixed fee − export credit.
// Interval cost fields are rounded per interval for display; bill lines are summed from exact
// energy per (version, period) and rounded once, so rounding can't accumulate over a month.

const INTERVAL_MS = 15 * 60_000;

type Bucket = 'pk' | 'md' | 'op';

/** Maps a TOU period name to a bill line: "Peak" → pk, "Off-peak" → op, anything else → md. */
export const bucketOf = (periodName: string): Bucket => {
  const n = periodName.toLowerCase().replace(/[^a-z]/g, '');
  if (n.startsWith('off')) return 'op';
  if (n.includes('peak')) return 'pk';
  return 'md';
};

const asTariff = (t: TariffDoc): TariffShape =>
  ({
    ...t,
    seasons: t.seasons ?? [],
    periods: t.periods ?? [],
    holidays: { dates: t.holidays?.dates ?? [], treatAs: t.holidays?.treatAs ?? 'weekend' },
  }) as unknown as TariffShape;

const loadTariffs = async (siteId: Types.ObjectId | string): Promise<TariffShape[]> =>
  (await Tariff.find({ siteId }).lean<TariffDoc[]>()).map(asTariff);

interface IntervalLike {
  start: Date;
  grid: number;
  export: number;
  pv?: number;
  batt?: number;
  demandKw: number;
  quality: string;
}

export interface IntervalCost {
  costCents: Record<Bucket, number>;
  creditCents: number;
  tariffVersion: number | null;
}

/** Energy cost of one interval's grid import with the version valid on its local date. */
export const costInterval = (iv: IntervalLike, tariffs: TariffShape[], tz: string): IntervalCost => {
  const v = tariffOn(tariffs, siteDate(iv.start, tz));
  if (!v) return { costCents: { pk: 0, md: 0, op: 0 }, creditCents: 0, tariffVersion: null };
  const costCents = { pk: 0, md: 0, op: 0 };
  for (const s of touSplit(v, iv.start, new Date(iv.start.getTime() + INTERVAL_MS), iv.grid, tz)) costCents[bucketOf(s.period)] += s.cents;
  return {
    costCents: { pk: Math.round(costCents.pk), md: Math.round(costCents.md), op: Math.round(costCents.op) },
    creditCents: Math.round(iv.export * v.exportRateCents),
    tariffVersion: v.version,
  };
};

export interface BillResult {
  period: string;
  start: Date;
  end: Date;
  inProgress: boolean;
  lines: {
    energyPkCents: number;
    energyMdCents: number;
    energyOpCents: number;
    demandCents: number;
    fixedCents: number;
    exportCreditCents: number;
  };
  energyKwh: { pk: number; md: number; op: number; export: number };
  totalCents: number;
  peakKw: number;
  peakAt: Date | null;
  tariffVersion: number | null;
  tariffVersions: number[];
  intervals: number;
  estimatedShare: number;
  unpricedIntervals: number;
  savedCents: number | null;
  savings: Savings | null;
}

export interface Savings {
  baselineCents: number;
  solarCents: number;
  batteryCents: number;
  demandCents: number;
  baselinePeakKw: number;
}

/** Savings are shown once a site has this many intervals (7 days). */
export const SAVINGS_MIN_INTERVALS = 7 * 96;

/**
 * Works out one billing period from its intervals. Pure: no database access.
 *
 * Savings (P2-04) compare with the same load bought entirely from the grid. Per interval
 * load = grid − export + pv + batt, so cost(load) − cost(grid) + credit splits exactly into
 * solar (cost of pv − export, plus the export credit) and battery (signed cost of batt);
 * demand avoided is the baseline peak (load × 4) minus the actual peak, at the demand rate.
 */
export const computeBill = (
  period: BillingPeriod,
  intervals: IntervalLike[],
  tariffs: TariffShape[],
  tz: string,
  now: Date,
  withSavings = false
): BillResult => {
  const cents: Record<Bucket, number> = { pk: 0, md: 0, op: 0 };
  const kwh: Record<Bucket, number> = { pk: 0, md: 0, op: 0 };
  let credit = 0;
  let exported = 0;
  let unpriced = 0;
  let solar = 0;
  let battery = 0;
  const versions = new Set<number>();
  for (const iv of intervals) {
    const v = tariffOn(tariffs, siteDate(iv.start, tz));
    if (!v) {
      unpriced++;
      continue;
    }
    versions.add(v.version);
    for (const s of touSplit(v, iv.start, new Date(iv.start.getTime() + INTERVAL_MS), iv.grid, tz)) {
      cents[bucketOf(s.period)] += s.cents;
      kwh[bucketOf(s.period)] += s.kwh;
    }
    credit += iv.export * v.exportRateCents;
    exported += iv.export;
    if (withSavings) {
      const end = new Date(iv.start.getTime() + INTERVAL_MS);
      const used = (iv.pv ?? 0) - iv.export;
      if (used) for (const s of touSplit(v, iv.start, end, used, tz)) solar += s.cents;
      if (iv.batt) for (const s of touSplit(v, iv.start, end, iv.batt, tz)) battery += s.cents;
    }
  }
  solar += credit;

  // Demand and fixed charges use the version in force on the period's last day so far.
  const lastDay = new Date(Math.min(period.end.getTime() - 1, now.getTime()));
  const chargeVersion = tariffOn(tariffs, siteDate(lastDay, tz));
  const peak = periodPeak(intervals, (chargeVersion?.demandIntervalMin ?? 15) as 15 | 30);
  const lines = {
    energyPkCents: Math.round(cents.pk),
    energyMdCents: Math.round(cents.md),
    energyOpCents: Math.round(cents.op),
    demandCents: chargeVersion && peak ? demandChargeCents(chargeVersion, peak.kw) : 0,
    fixedCents: chargeVersion?.fixedCents ?? 0,
    exportCreditCents: Math.round(credit),
  };
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const totalCents = lines.energyPkCents + lines.energyMdCents + lines.energyOpCents + lines.demandCents + lines.fixedCents - lines.exportCreditCents;

  let savings: Savings | null = null;
  if (withSavings) {
    const loadRows = intervals.map((iv) => ({ start: iv.start, demandKw: Math.max(0, iv.grid - iv.export + (iv.pv ?? 0) + (iv.batt ?? 0)) * 4 }));
    const basePeak = periodPeak(loadRows, (chargeVersion?.demandIntervalMin ?? 15) as 15 | 30);
    const baseDemand = chargeVersion && basePeak ? demandChargeCents(chargeVersion, basePeak.kw) : 0;
    const parts = { solarCents: Math.round(solar), batteryCents: Math.round(battery), demandCents: baseDemand - lines.demandCents };
    savings = {
      baselineCents: totalCents + parts.solarCents + parts.batteryCents + parts.demandCents,
      ...parts,
      baselinePeakKw: basePeak ? Math.round(basePeak.kw * 100) / 100 : 0,
    };
  }

  return {
    period: period.period,
    start: period.start,
    end: period.end,
    inProgress: now < period.end,
    lines,
    energyKwh: { pk: r3(kwh.pk), md: r3(kwh.md), op: r3(kwh.op), export: r3(exported) },
    totalCents,
    peakKw: peak ? Math.round(peak.kw * 100) / 100 : 0,
    peakAt: peak?.at ?? null,
    tariffVersion: chargeVersion?.version ?? null,
    tariffVersions: [...versions].sort((a, b) => a - b),
    intervals: intervals.length,
    estimatedShare: intervals.length ? Math.round((intervals.filter((i) => i.quality === 'estimated').length / intervals.length) * 10_000) / 10_000 : 0,
    unpricedIntervals: unpriced,
    savedCents: savings ? savings.solarCents + savings.batteryCents + savings.demandCents : null,
    savings,
  };
};

/** Recomputes and stores the bill for the billing period that contains `at`. */
export const refreshBill = async (site: SiteDoc, at: Date, now = new Date()): Promise<BillDoc> => {
  const period = billingPeriod(at, site.tz, site.billDay ?? 1);
  const [intervals, tariffs, history] = await Promise.all([
    Interval15.find({ siteId: site._id, start: { $gte: period.start, $lt: period.end } })
      .select('start grid export pv batt demandKw quality')
      .lean<IntervalLike[]>(),
    loadTariffs(site._id),
    Interval15.countDocuments({ siteId: site._id, start: { $lt: now } }, { limit: SAVINGS_MIN_INTERVALS }),
  ]);
  const bill = computeBill(period, intervals, tariffs, site.tz, now, history >= SAVINGS_MIN_INTERVALS);
  return (await Bill.findOneAndUpdate(
    { siteId: site._id, period: bill.period },
    { $set: { ...bill, computedAt: now } },
    { upsert: true, new: true }
  ).lean<BillDoc>())!;
};

/**
 * Prices every interval that has no cost yet (new or recomputed by ingest), then refreshes the
 * bills of the periods they belong to. Returns how many intervals were priced.
 */
export const costPendingIntervals = async (now = new Date(), limit = 5000): Promise<number> => {
  const pending = await Interval15.find({ costedAt: null }).sort({ start: 1 }).limit(limit).lean();
  if (pending.length === 0) return 0;
  const bySite = new Map<string, typeof pending>();
  for (const iv of pending) {
    const list = bySite.get(String(iv.siteId)) ?? [];
    list.push(iv);
    bySite.set(String(iv.siteId), list);
  }
  for (const [siteId, list] of bySite) {
    const site = await Site.findById(siteId).lean<SiteDoc>();
    if (!site) {
      // Orphaned rows would otherwise be picked up again on every pass.
      await Interval15.updateMany({ _id: { $in: list.map((iv) => iv._id) } }, { $set: { costedAt: now } });
      continue;
    }
    const tariffs = await loadTariffs(siteId);
    await Interval15.bulkWrite(
      list.map((iv) => {
        const c = costInterval(iv as unknown as IntervalLike, tariffs, site.tz);
        // Only mark it costed if nobody recomputed the interval in the meantime.
        return { updateOne: { filter: { _id: iv._id, updatedAt: iv.updatedAt }, update: { $set: { ...c, costedAt: now } } } };
      })
    );
    const periods = new Map<string, Date>();
    for (const iv of list) periods.set(billingPeriod(iv.start, site.tz, site.billDay ?? 1).period, iv.start);
    for (const at of periods.values()) await refreshBill(site, at, now);
  }
  return pending.length;
};

/** Nightly: recompute the current and the previous period of every site whose local hour is `hour`. */
export const nightlyBills = async (now = new Date(), hour = 1): Promise<number> => {
  let done = 0;
  for (const site of await Site.find().lean<SiteDoc[]>()) {
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: site.tz }).format(now));
    if (localHour !== hour) continue;
    const current = billingPeriod(now, site.tz, site.billDay ?? 1);
    await refreshBill(site, now, now);
    await refreshBill(site, new Date(current.start.getTime() - 1), now);
    done++;
  }
  return done;
};
