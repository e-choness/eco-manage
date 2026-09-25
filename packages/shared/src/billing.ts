import { siteDate } from './time';
import { demandChargeCents, periodPeak, tariffOn, touSplit, type Tariff } from './tariff';
import type { BillingPeriod } from './time';

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

/** A stored tariff document (lean) as the pricing functions expect it. */
export const tariffFromDoc = (t: object): Tariff => {
  const d = t as Partial<Tariff>;
  return {
    ...(d as Tariff),
    seasons: d.seasons ?? [],
    periods: d.periods ?? [],
    holidays: { dates: d.holidays?.dates ?? [], treatAs: d.holidays?.treatAs ?? 'weekend' },
  };
};

export interface IntervalLike {
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
export const costInterval = (iv: IntervalLike, tariffs: Tariff[], tz: string): IntervalCost => {
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
  tariffs: Tariff[],
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
