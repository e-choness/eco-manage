import { bucketOf, periodAt, priceAt, siteDateStart, siteDate, type Tariff } from '@ecomanage/shared';
import type { ForecastStep, RecContext } from './types';

// Small helpers the rules share: local times, money in the App v2 style, tariff period spans.

export const STEP_MS = 15 * 60_000;
export const HOUR_MS = 3_600_000;

export const hhmm = (at: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(at);

export const dayMonthTime = (at: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(at).replace(',', '');

/** "$266" for whole dollars, "$4.62" otherwise (App v2). */
export const money = (cents: number): string => {
  const d = Math.abs(cents) / 100;
  return `${cents < 0 ? '−' : ''}$${Number.isInteger(d) ? d.toLocaleString('en-US') : d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** A rate in cents per kWh as "$0.27". */
export const perKwh = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export const ceilTo = (x: number, step: number): number => Math.ceil(x / step - 1e-9) * step;
export const round1 = (x: number): number => Math.round(x * 10) / 10;

export interface PeriodSpan {
  start: Date;
  end: Date;
  name: string;
  bucket: 'pk' | 'md' | 'op';
  rateCents: number;
}

/** The tariff's periods as contiguous spans from `from` for `hours`, in 15-minute steps. */
export const periodSpans = (tariff: Tariff, from: Date, hours: number, tz: string): PeriodSpan[] => {
  const spans: PeriodSpan[] = [];
  const first = Math.floor(from.getTime() / STEP_MS) * STEP_MS;
  for (let t = first; t < first + hours * HOUR_MS; t += STEP_MS) {
    const p = periodAt(tariff, new Date(t), tz);
    const last = spans.at(-1);
    if (last && last.name === p.name && last.rateCents === p.rateCents && last.end.getTime() === t) last.end = new Date(t + STEP_MS);
    else spans.push({ start: new Date(t), end: new Date(t + STEP_MS), name: p.name, bucket: bucketOf(p.name), rateCents: p.rateCents });
  }
  return spans;
};

/** The whole tariff period (within a day either side) containing `at`. */
export const spanAt = (tariff: Tariff, at: Date, tz: string): PeriodSpan =>
  periodSpans(tariff, new Date(at.getTime() - 24 * HOUR_MS), 48, tz).find((s) => s.start <= at && at < s.end)!;

export const rateAt = (tariff: Tariff, at: Date, tz: string): number => priceAt(tariff, at, tz);

/** Forecast steps in [start, end). */
export const stepsIn = (ctx: RecContext, start: Date, end: Date): ForecastStep[] => ctx.forecast.filter((s) => s.ts >= start && s.ts < end);

/** The highest of `pick` over the steps, with its step. */
export const maxBy = <T>(xs: T[], pick: (x: T) => number | null): { item: T; value: number } | null => {
  let best: { item: T; value: number } | null = null;
  for (const x of xs) {
    const v = pick(x);
    if (v !== null && (!best || v > best.value)) best = { item: x, value: v };
  }
  return best;
};

/** The next time the local clock reads `time` (HH:mm) after `after`. */
export const nextLocalTime = (after: Date, time: string, tz: string): Date => {
  const [h, m] = time.split(':').map(Number);
  let date = siteDate(after, tz);
  for (let i = 0; i < 3; i++) {
    const at = new Date(siteDateStart(date, tz).getTime() + (h * 60 + m) * 60_000);
    if (at > after) return at;
    date = new Date(Date.parse(`${date}T12:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
  }
  return new Date(after.getTime() + 24 * HOUR_MS);
};

export const dayLabel = (ctx: RecContext): string => (ctx.dayClass === 'open' ? 'open day' : 'closed day');
