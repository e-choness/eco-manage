import { isSiteWeekend, siteDate } from '@ecomanage/shared';

// School calendar for the demo site (App v2 Settings → Calendar).

export interface SchoolCalendar {
  terms: { start: string; end: string }[];
  daysOff: { start: string; end: string }[];
  open: number; // minutes after local midnight
  close: number;
}

export const DEMO_CALENDAR: SchoolCalendar = {
  terms: [
    { start: '2026-09-02', end: '2026-12-18' },
    { start: '2027-01-05', end: '2027-03-12' },
    { start: '2027-03-23', end: '2027-06-25' },
  ],
  daysOff: [
    { start: '2026-10-09', end: '2026-10-09' },
    { start: '2026-10-12', end: '2026-10-12' },
    { start: '2026-12-21', end: '2027-01-01' },
  ],
  open: 7 * 60 + 30,
  close: 17 * 60 + 30,
};

export type DayType = 'school' | 'weekday-closed' | 'weekend';

const within = (d: string, r: { start: string; end: string }) => d >= r.start && d <= r.end;

export const dayType = (at: Date, tz: string, cal: SchoolCalendar): DayType => {
  if (isSiteWeekend(at, tz)) return 'weekend';
  const d = siteDate(at, tz);
  if (cal.daysOff.some((r) => within(d, r))) return 'weekday-closed';
  return cal.terms.some((r) => within(d, r)) ? 'school' : 'weekday-closed';
};
