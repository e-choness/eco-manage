import { DateTime } from 'luxon';
import { siteZone } from './time';

// Report schedules (P5-01). A weekly report runs on Monday and a monthly one on the 1st, both at
// 07:00 in the site's time zone, and each run covers the previous full week (Monday to Sunday)
// or calendar month. A one-off report covers the dates it was made with and runs once.

export type RepeatingSchedule = 'weekly' | 'monthly';

export const REPORT_RUN_HOUR = 7;

/** Cron pattern for the BullMQ job scheduler; it runs with the site's time zone as `tz`. */
export const reportCron = (schedule: RepeatingSchedule): string => (schedule === 'weekly' ? `0 ${REPORT_RUN_HOUR} * * 1` : `0 ${REPORT_RUN_HOUR} 1 * *`);

/** BullMQ job scheduler id for a report: one scheduler per report. */
export const reportSchedulerId = (reportId: string): string => `report:${reportId}`;

const local = (at: Date, tz: string): DateTime => DateTime.fromJSDate(at, { zone: siteZone(tz) });

/** The next run strictly after `now`: the 1st (monthly) or Monday (weekly) at 07:00 site time. */
export const nextReportRun = (schedule: RepeatingSchedule, tz: string, now: Date): Date => {
  const t = local(now, tz);
  const start = schedule === 'weekly' ? t.startOf('week') : t.startOf('month'); // Luxon weeks start on Monday
  let run = start.set({ hour: REPORT_RUN_HOUR });
  if (run.toMillis() <= t.toMillis()) run = start.plus(schedule === 'weekly' ? { weeks: 1 } : { months: 1 }).set({ hour: REPORT_RUN_HOUR });
  return run.toJSDate();
};

/**
 * Local dates a scheduled run covers: the full week or month before the one it runs in. A run a
 * little late (a worker restart) still covers the same period.
 */
export const reportRunRange = (schedule: RepeatingSchedule, runAt: Date, tz: string): { from: string; to: string } => {
  const unit = schedule === 'weekly' ? 'week' : 'month';
  const current = local(runAt, tz).startOf(unit);
  const previous = current.minus(unit === 'week' ? { weeks: 1 } : { months: 1 });
  return { from: previous.toISODate() as string, to: current.minus({ days: 1 }).toISODate() as string };
};
