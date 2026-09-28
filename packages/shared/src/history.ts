import { z } from 'zod';
import { DateTime } from 'luxon';
import { siteZone } from './time';

// History (plan P4-05, Backend Coverage: GET /api/history/series and /totals). Any range of
// local dates the site has data for, at a resolution that keeps the chart under 400 bars, built
// from the permanent 15-minute intervals.

export const HISTORY_RES = ['15m', 'h', 'd', 'w', 'mo'] as const;
export type HistoryRes = (typeof HISTORY_RES)[number];
export const MAX_BARS = 400;

export const RES_LABEL: Record<HistoryRes, string> = { '15m': '15-min', h: 'hourly', d: 'daily', w: 'weekly', mo: 'monthly' };

const localDate = z.string().date();

export const historyQuery = z
  .object({
    from: localDate,
    to: localDate,
    res: z.enum(['auto', ...HISTORY_RES]).default('auto'),
  })
  .strict();
export type HistoryQuery = z.infer<typeof historyQuery>;

export const COMPARE = ['none', 'prev', 'yoy'] as const;
export type Compare = (typeof COMPARE)[number];

export const totalsQuery = z
  .object({ from: localDate, to: localDate, compare: z.enum(COMPARE).default('none') })
  .strict();
export type TotalsQuery = z.infer<typeof totalsQuery>;

/** What App v2 picks when the resolution is Auto. */
export const autoRes = (days: number): HistoryRes => (days <= 2 ? 'h' : days <= 92 ? 'd' : days <= 400 ? 'w' : 'mo');

/** Local days from `from` to `to`, both included. */
export const daysBetween = (from: string, to: string): number => Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days) + 1;

/** Upper bound of the bars a resolution draws for a range (DST days count as 24 h). */
export const barCount = (res: HistoryRes, days: number): number =>
  res === '15m' ? days * 96 : res === 'h' ? days * 24 : res === 'd' ? days : res === 'w' ? Math.ceil(days / 7) + 1 : Math.ceil(days / 30.4) + 1;

export interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  res: HistoryRes;
  warnings: string[];
}

const human = (date: string) => DateTime.fromISO(date).toFormat('d LLL yyyy');

/**
 * The range and resolution to draw: swapped if backwards, kept inside the data the site has, and
 * coarser when the chosen resolution would draw more than 400 bars (the CSV keeps every interval).
 */
export const resolveRange = (q: HistoryQuery, dataStart: string, today: string): ResolvedRange => {
  const warnings: string[] = [];
  let [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
  if (from < dataStart) {
    warnings.push(`No data before ${human(dataStart)}, when the site started reporting. The range starts there.`);
    from = dataStart;
  }
  if (to > today) {
    warnings.push('No data after today.');
    to = today;
  }
  if (from > to) from = to;
  const days = daysBetween(from, to);
  const auto = autoRes(days);
  let res = q.res === 'auto' ? auto : q.res;
  const bars = barCount(res, days);
  if (bars > MAX_BARS) {
    warnings.push(`A ${RES_LABEL[res]} view would draw ${bars.toLocaleString('en-US')} bars, so it shows ${RES_LABEL[auto]}. CSV export keeps every 15-min interval.`);
    res = auto;
  }
  return { from, to, days, res, warnings };
};

/** The range to compare with: the same number of days just before, or the same dates a year earlier. */
export const compareRange = (from: string, to: string, mode: Exclude<Compare, 'none'>): { from: string; to: string } => {
  const a = DateTime.fromISO(from);
  const b = DateTime.fromISO(to);
  if (mode === 'yoy') return { from: a.minus({ years: 1 }).toISODate() as string, to: b.minus({ years: 1 }).toISODate() as string };
  const days = daysBetween(from, to);
  return { from: a.minus({ days }).toISODate() as string, to: a.minus({ days: 1 }).toISODate() as string };
};

const UNIT: Record<HistoryRes, { minutes: number } | { hours: number } | { days: number } | { weeks: number } | { months: number }> = {
  '15m': { minutes: 15 },
  h: { hours: 1 },
  d: { days: 1 },
  w: { weeks: 1 },
  mo: { months: 1 },
};

/** Start of the bucket holding a local time: weeks start on Monday (ISO), as in MongoDB's $dateTrunc. */
const truncate = (t: DateTime, res: HistoryRes): DateTime =>
  res === '15m' ? t.startOf('hour').plus({ minutes: Math.floor(t.minute / 15) * 15 }) : t.startOf(res === 'h' ? 'hour' : res === 'd' ? 'day' : res === 'w' ? 'week' : 'month');

/** Every bucket start (UTC ISO) from the start of `from` to the end of `to`, in the site's zone. */
export const bucketStarts = (from: string, to: string, res: HistoryRes, tz: string): string[] => {
  const end = DateTime.fromISO(to, { zone: siteZone(tz) }).startOf('day').plus({ days: 1 });
  const out: string[] = [];
  for (let t = truncate(DateTime.fromISO(from, { zone: siteZone(tz) }).startOf('day'), res); t < end; t = t.plus(UNIT[res])) out.push(t.toUTC().toISO() as string);
  return out;
};

/** One bar of the History chart. kWh fields are energy in the bucket; `n` counts its 15-min intervals. */
export interface HistoryBucket {
  start: string;
  pv: number;
  used: number; // solar used on site
  batt: number; // battery discharge into the site
  grid: number; // bought
  export: number; // sold
  bld: number; // building (calculated remainder)
  hp: number;
  ev: number;
  peakKw: number; // highest 15-min demand
  costCents: number | null; // energy at TOU prices; null for installers
  estimated: boolean; // any interval in it was estimated
  n: number;
}

export interface HistorySeries extends ResolvedRange {
  dataStart: string;
  today: string;
  buckets: HistoryBucket[];
}

export interface HistoryTotals {
  pvKwh: number;
  gridKwh: number;
  exportKwh: number;
  peak: { kw: number; at: string } | null;
  costCents: number | null; // null for installers
  estimatedIntervals: number;
  intervals: number;
}

export interface HistoryTotalsResponse {
  from: string;
  to: string;
  totals: HistoryTotals;
  compare: { from: string; to: string; totals: HistoryTotals | null } | null; // totals null: no data then
}

/** "+12%" against the comparison, or null when there is nothing to compare with. */
export const changePct = (now: number | null, before: number | null): number | null =>
  now == null || before == null || before === 0 ? null : Math.round(((now - before) / before) * 100);
