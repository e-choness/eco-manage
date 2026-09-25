import { DateTime, IANAZone } from 'luxon';

// Timestamps are stored in UTC. Anything tied to a tariff, calendar or bill is worked out in the
// site's time zone (plan §0.5). Never use the server's local time.

export const isValidZone = (tz: string): boolean => IANAZone.isValidZone(tz);

const inZone = (at: Date, tz: string): DateTime => {
  if (!isValidZone(tz)) throw new RangeError(`Unknown time zone: ${tz}`);
  return DateTime.fromJSDate(at, { zone: tz });
};

/** Calendar date in the site's zone, e.g. "2026-09-24". */
export const siteDate = (at: Date, tz: string): string => inZone(at, tz).toISODate() as string;

/** Minutes since local midnight, 0..1439, in the site's zone. */
export const siteMinuteOfDay = (at: Date, tz: string): number => {
  const d = inZone(at, tz);
  return d.hour * 60 + d.minute;
};

/** ISO weekday in the site's zone: 1 = Monday … 7 = Sunday. */
export const siteWeekday = (at: Date, tz: string): number => inZone(at, tz).weekday;

export const isSiteWeekend = (at: Date, tz: string): boolean => siteWeekday(at, tz) >= 6;

/** Start of the local day containing `at`, as a UTC Date (handles 23 h and 25 h DST days). */
export const startOfSiteDay = (at: Date, tz: string): Date => inZone(at, tz).startOf('day').toJSDate();

/** Start of the next local day. */
export const endOfSiteDay = (at: Date, tz: string): Date => inZone(at, tz).startOf('day').plus({ days: 1 }).toJSDate();

/** Local midnight of a "YYYY-MM-DD" date in the site's zone. */
export const siteDateStart = (date: string, tz: string): Date => {
  const d = DateTime.fromISO(date, { zone: tz });
  if (!d.isValid || !isValidZone(tz)) throw new RangeError(`Invalid date or zone: ${date} ${tz}`);
  return d.startOf('day').toJSDate();
};

/**
 * Start of the demand/billing interval that contains `at`. Intervals are aligned to local clock
 * time (:00, :15, :30, :45 for 15 min), which also works for zones with 30/45-minute offsets.
 */
export const intervalStart = (at: Date, tz: string, minutes: 15 | 30 = 15): Date => {
  const d = inZone(at, tz);
  // Subtract on the epoch rather than setting wall-clock fields: during the repeated hour at the
  // end of DST, setting fields could land on the other occurrence of the same local time.
  const intoInterval = ((d.minute % minutes) * 60 + d.second) * 1000 + d.millisecond;
  return new Date(at.getTime() - intoInterval);
};

/** Start of the interval after the one containing `at`. */
export const nextIntervalStart = (at: Date, tz: string, minutes: 15 | 30 = 15): Date =>
  new Date(intervalStart(at, tz, minutes).getTime() + minutes * 60_000);

export interface BillingPeriod {
  period: string; // "YYYY-MM" of the month the period starts in
  start: Date; // inclusive, UTC
  end: Date; // exclusive, UTC
}

/**
 * Billing period containing `at`. A period starts at local midnight on `billDay` (1–28) and runs
 * to the same day of the next month.
 */
export const billingPeriod = (at: Date, tz: string, billDay = 1): BillingPeriod => {
  if (!Number.isInteger(billDay) || billDay < 1 || billDay > 28) throw new RangeError('billDay must be 1–28');
  const d = inZone(at, tz);
  let start = d.set({ day: billDay }).startOf('day');
  if (d < start) start = start.minus({ months: 1 });
  const end = start.plus({ months: 1 });
  return { period: start.toFormat('yyyy-MM'), start: start.toJSDate(), end: end.toJSDate() };
};

/** Local wall-clock time "HH:mm" in the site's zone. */
export const siteClock = (at: Date, tz: string): string => inZone(at, tz).toFormat('HH:mm');
