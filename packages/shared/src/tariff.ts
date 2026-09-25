import { z } from 'zod';
import { DateTime } from 'luxon';

// Tariffs (plan §2, P2-01/P2-02). Periods are written in site-local wall-clock time. A period
// applies to a season (a month range, possibly wrapping the year end) or all year, and to
// weekdays, weekends or every day. Statutory holidays count as weekends or as weekdays.
// Rates are cents per kWh (fractions allowed); totals are rounded to whole cents.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');

export const DAY_SETS = ['weekdays', 'weekends', 'all'] as const;
export type DaySet = (typeof DAY_SETS)[number];
export type DayType = 'weekday' | 'weekend';

export const seasonSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  fromMonth: z.number().int().min(1).max(12),
  toMonth: z.number().int().min(1).max(12), // inclusive; fromMonth > toMonth wraps the year end
});
export type Season = z.infer<typeof seasonSchema>;

export const periodSchema = z.object({
  name: z.string().min(1).max(40), // "Peak", "Mid", "Off-peak" …
  season: z.string().default('all'), // season id or "all"
  days: z.enum(DAY_SETS),
  start: hhmm,
  end: hhmm, // at or before start (e.g. "00:00") means midnight; overnight periods are two periods
  rateCents: z.number().nonnegative().max(1000),
});
export type Period = z.infer<typeof periodSchema>;

export const tariffInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    validFrom: z.string().date(), // local date in the site's time zone
    seasons: z.array(seasonSchema).default([]),
    periods: z.array(periodSchema).min(1),
    demandRateCents: z.number().nonnegative(), // per kW per billing period
    demandIntervalMin: z.union([z.literal(15), z.literal(30)]),
    exportRateCents: z.number(), // per kWh; may be negative
    fixedCents: z.number().int().nonnegative(), // per billing period
    holidays: z.object({ dates: z.array(z.string().date()).default([]), treatAs: z.enum(['weekend', 'weekday']).default('weekend') }).default({}),
  })
  .strict();
export type TariffInput = z.infer<typeof tariffInput>;

export interface Tariff extends TariffInput {
  version: number;
}

// ---- time helpers ----------------------------------------------------------------------------

export const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Minute range of a period; end "00:00" (or start = end) runs to midnight. */
const range = (p: Pick<Period, 'start' | 'end'>): [number, number] => {
  const a = minutesOf(p.start);
  const b = minutesOf(p.end);
  return [a, b <= a ? 1440 : b];
};

export const seasonHasMonth = (s: Pick<Season, 'fromMonth' | 'toMonth'>, month: number): boolean =>
  s.fromMonth <= s.toMonth ? month >= s.fromMonth && month <= s.toMonth : month >= s.fromMonth || month <= s.toMonth;

const periodApplies = (p: Period, seasons: Season[], month: number, dayType: DayType): boolean => {
  if (p.days !== 'all' && p.days !== (dayType === 'weekday' ? 'weekdays' : 'weekends')) return false;
  if (p.season === 'all') return true;
  const s = seasons.find((x) => x.id === p.season);
  return !!s && seasonHasMonth(s, month);
};

// ---- validation (P2-01) ------------------------------------------------------------------------

export interface TariffIssue {
  kind: 'gap' | 'overlap' | 'unknown-season' | 'season-overlap' | 'valid-from';
  message: string;
  months?: string; // e.g. "Apr–Oct"
  days?: DayType;
  from?: string;
  to?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Groups months with the same problem into ranges: [4,5,6,7] -> "Apr–Jul". */
const monthRanges = (months: number[]): string => {
  const sorted = [...months].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? MONTHS[sorted[i] - 1] : `${MONTHS[sorted[i] - 1]}–${MONTHS[sorted[j] - 1]}`);
    i = j + 1;
  }
  return parts.join(', ');
};

/**
 * Every month and day type must be covered by exactly one period at every minute of the day.
 * Returns the gaps and overlaps found (plan P2-01: 422 with the list); empty means valid.
 */
export const validateTariff = (t: Pick<TariffInput, 'seasons' | 'periods'>): TariffIssue[] => {
  const issues: TariffIssue[] = [];
  const ids = new Set(t.seasons.map((s) => s.id));
  for (const p of t.periods) {
    if (p.season !== 'all' && !ids.has(p.season)) {
      issues.push({ kind: 'unknown-season', message: `${p.name} ${p.start}–${p.end} uses unknown season "${p.season}"` });
    }
  }
  for (let m = 1; m <= 12; m++) {
    const owners = t.seasons.filter((s) => seasonHasMonth(s, m));
    if (owners.length > 1) {
      issues.push({ kind: 'season-overlap', message: `${MONTHS[m - 1]} is in more than one season (${owners.map((s) => s.name).join(', ')})`, months: MONTHS[m - 1] });
    }
  }

  // Collect gaps and overlaps per (day type, minute range), then merge the months they affect.
  const found = new Map<string, { issue: Omit<TariffIssue, 'months' | 'message'>; months: number[]; names: string }>();
  for (const dayType of ['weekday', 'weekend'] as const) {
    for (let month = 1; month <= 12; month++) {
      const cover = new Array<number>(1440).fill(0);
      const who: string[][] = Array.from({ length: 1440 }, () => []);
      for (const p of t.periods.filter((x) => periodApplies(x, t.seasons, month, dayType))) {
        const [a, b] = range(p);
        for (let i = a; i < b; i++) {
          cover[i]++;
          who[i].push(`${p.name} ${p.start}–${p.end}`);
        }
      }
      let i = 0;
      while (i < 1440) {
        const state = cover[i] === 0 ? 'gap' : cover[i] > 1 ? 'overlap' : 'ok';
        let j = i;
        while (j + 1 < 1440 && (cover[j + 1] === 0 ? 'gap' : cover[j + 1] > 1 ? 'overlap' : 'ok') === state) j++;
        if (state !== 'ok') {
          const names = state === 'overlap' ? [...new Set(who[i])].join(' and ') : '';
          const key = `${state}|${dayType}|${i}|${j}|${names}`;
          const entry = found.get(key) ?? { issue: { kind: state, days: dayType, from: clock(i), to: clock(j + 1) }, months: [], names };
          entry.months.push(month);
          found.set(key, entry);
        }
        i = j + 1;
      }
    }
  }
  for (const { issue, months, names } of found.values()) {
    const when = `${issue.days === 'weekday' ? 'weekdays' : 'weekends'}, ${monthRanges(months)}`;
    const message =
      issue.kind === 'gap' ? `No rate for ${issue.from}–${issue.to} (${when})` : `${names} overlap ${issue.from}–${issue.to} (${when})`;
    issues.push({ ...issue, months: monthRanges(months), message });
  }
  return issues;
};

// ---- pricing (P2-02) ---------------------------------------------------------------------------

/** Weekday or weekend in the site's zone; holidays follow the tariff's rule. */
export const dayTypeAt = (at: Date, tz: string, holidays: TariffInput['holidays']): DayType => {
  const local = DateTime.fromJSDate(at, { zone: tz });
  if (holidays.dates.includes(local.toISODate() as string)) return holidays.treatAs;
  return local.weekday >= 6 ? 'weekend' : 'weekday';
};

/** The period in force at an instant. Throws if the tariff has a gap there (validate first). */
export const periodAt = (t: Pick<TariffInput, 'seasons' | 'periods' | 'holidays'>, at: Date, tz: string): Period => {
  const local = DateTime.fromJSDate(at, { zone: tz });
  const minute = local.hour * 60 + local.minute;
  const dayType = dayTypeAt(at, tz, t.holidays);
  const p = t.periods.find((x) => {
    if (!periodApplies(x, t.seasons, local.month, dayType)) return false;
    const [a, b] = range(x);
    return minute >= a && minute < b;
  });
  if (!p) throw new Error(`No tariff period at ${local.toISO()}`);
  return p;
};

/** Energy price at an instant, cents per kWh. */
export const priceAt = (t: Pick<TariffInput, 'seasons' | 'periods' | 'holidays'>, at: Date, tz: string): number => periodAt(t, at, tz).rateCents;

export interface TouShare {
  period: string;
  kwh: number;
  cents: number; // unrounded
}

/**
 * Splits energy used evenly over [start, end) across the periods it falls in (P2-02 "TOU split of
 * an interval"). Works minute by minute, so period boundaries inside the interval and DST changes
 * are handled; a 15-minute interval normally lands in one period.
 */
export const touSplit = (t: Pick<TariffInput, 'seasons' | 'periods' | 'holidays'>, start: Date, end: Date, kwh: number, tz: string): TouShare[] => {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes <= 0) return [];
  const byPeriod = new Map<string, TouShare>();
  const perMinute = kwh / minutes;
  for (let i = 0; i < minutes; i++) {
    const p = periodAt(t, new Date(start.getTime() + i * 60_000), tz);
    const share = byPeriod.get(p.name) ?? { period: p.name, kwh: 0, cents: 0 };
    share.kwh += perMinute;
    share.cents += perMinute * p.rateCents;
    byPeriod.set(p.name, share);
  }
  return [...byPeriod.values()];
};

/** Demand charge for a billing period: highest demand × rate, whole cents. */
export const demandChargeCents = (t: Pick<TariffInput, 'demandRateCents'>, peakKw: number): number =>
  Math.round(Math.max(0, peakKw) * t.demandRateCents);

/**
 * Highest demand in a billing period from its 15-minute intervals. With a 30-minute demand
 * interval, the two quarter hours of each half hour (aligned to :00 and :30) are averaged first.
 */
export const periodPeak = (
  intervals: { start: Date; demandKw: number }[],
  demandIntervalMin: 15 | 30
): { kw: number; at: Date } | null => {
  if (intervals.length === 0) return null;
  let buckets = intervals.map((i) => ({ at: i.start, kw: i.demandKw }));
  if (demandIntervalMin === 30) {
    const halves = new Map<number, { at: Date; sum: number; n: number }>();
    for (const i of intervals) {
      const key = Math.floor(i.start.getTime() / 1_800_000);
      const h = halves.get(key) ?? { at: new Date(key * 1_800_000), sum: 0, n: 0 };
      h.sum += i.demandKw;
      h.n++;
      halves.set(key, h);
    }
    buckets = [...halves.values()].map((h) => ({ at: h.at, kw: h.sum / h.n }));
  }
  return buckets.reduce((best, b) => (b.kw > best.kw ? b : best));
};

// ---- versions -------------------------------------------------------------------------------

/**
 * The version in force on a local date: the latest validFrom on or before it, the highest version
 * among equals (P2-01: a new version never changes earlier days).
 */
export const tariffOn = <T extends Pick<Tariff, 'validFrom' | 'version'>>(versions: T[], localDate: string): T | null => {
  let best: T | null = null;
  for (const v of versions) {
    if (v.validFrom > localDate) continue;
    if (!best || v.validFrom > best.validFrom || (v.validFrom === best.validFrom && v.version > best.version)) best = v;
  }
  return best;
};

// ---- templates ---------------------------------------------------------------------------------

const TOU_SEASONS: Season[] = [
  { id: 'summer', name: 'Apr–Oct', fromMonth: 4, toMonth: 10 },
  { id: 'winter', name: 'Nov–Mar', fromMonth: 11, toMonth: 3 },
];

/** Starting points for the Tariff settings (App v2 "Load periods from a template"). */
export const TARIFF_TEMPLATES: { id: string; name: string; tariff: Omit<TariffInput, 'validFrom'> }[] = [
  {
    id: 'commercial-tou-d',
    name: 'Commercial TOU-D (Toronto utility)',
    tariff: {
      name: 'Commercial TOU-D',
      seasons: TOU_SEASONS,
      periods: [
        { name: 'Off-peak', season: 'all', days: 'weekdays', start: '00:00', end: '07:00', rateCents: 9 },
        { name: 'Mid', season: 'summer', days: 'weekdays', start: '07:00', end: '14:00', rateCents: 16 },
        { name: 'Peak', season: 'summer', days: 'weekdays', start: '14:00', end: '20:00', rateCents: 27 },
        { name: 'Mid', season: 'summer', days: 'weekdays', start: '20:00', end: '00:00', rateCents: 16 },
        { name: 'Peak', season: 'winter', days: 'weekdays', start: '07:00', end: '11:00', rateCents: 25 },
        { name: 'Mid', season: 'winter', days: 'weekdays', start: '11:00', end: '17:00', rateCents: 16 },
        { name: 'Peak', season: 'winter', days: 'weekdays', start: '17:00', end: '19:00', rateCents: 25 },
        { name: 'Off-peak', season: 'winter', days: 'weekdays', start: '19:00', end: '00:00', rateCents: 9 },
        { name: 'Off-peak', season: 'all', days: 'weekends', start: '00:00', end: '00:00', rateCents: 9 },
      ],
      demandRateCents: 1400,
      demandIntervalMin: 15,
      exportRateCents: 5,
      fixedCents: 9000,
      holidays: { dates: [], treatAs: 'weekend' },
    },
  },
  {
    id: 'flat-commercial',
    name: 'Flat commercial rate',
    tariff: {
      name: 'Flat commercial rate',
      seasons: [],
      periods: [{ name: 'Mid', season: 'all', days: 'all', start: '00:00', end: '00:00', rateCents: 15 }],
      demandRateCents: 0,
      demandIntervalMin: 15,
      exportRateCents: 5,
      fixedCents: 9000,
      holidays: { dates: [], treatAs: 'weekend' },
    },
  },
];
