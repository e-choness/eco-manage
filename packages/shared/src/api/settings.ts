import { z } from 'zod';

// Site settings and calendar (plan P2-06, App v2 Settings → Site and Calendar).
// Who may change what: site details owner; solar arrays and battery owner or installer;
// calendar owner or manager; the gateway card is read-only for everyone.

export const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'] as const;

/** Minimum hardware reserve: no command may take the battery below this (plan §1). */
export const BATTERY_FLOOR_MIN_PCT = 10;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'invalid date');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');

export interface PvArray {
  id: string;
  name: string;
  inverterId: string; // a pv device of the site
  kwp: number;
  tiltDeg: number;
  azimuthDeg: number; // 180 = due south
}

export interface BatterySettings {
  deviceId: string;
  usableKwh: number | null;
  maxKw: number | null;
  floorPct: number;
}

export interface SiteSettings {
  id: string;
  name: string;
  address: string;
  tz: string;
  lat: number | null;
  lon: number | null;
  currency: string;
  billDay: number;
  demandCapKw: number | null;
  pvArrays: PvArray[];
  battery: BatterySettings | null;
}

export interface GatewayView {
  id: string | null;
  online: boolean;
  fw: string | null;
  uptimeS: number | null;
  buffered: number | null;
  oldestBufferedTs: string | null;
  clockOffsetMs: number | null;
  lastSeenAt: string | null;
  bufferDays: number; // how long the gateway can hold readings while offline
  batteryFloorPct: number | null; // the floor the gateway enforces
  configPending: boolean; // the floor could not be sent yet; it is resent on reconnect
}

/** PATCH /api/site (owner). */
export const sitePatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(200),
    tz: z.string().refine(isTimeZone, 'unknown time zone'),
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    currency: z.enum(CURRENCIES),
    billDay: z.number().int().min(1).max(28),
    demandCapKw: z.number().positive().max(100_000).nullable(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type SitePatch = z.infer<typeof sitePatch>;

/** PUT /api/site/pv-arrays (owner, installer): the whole table. */
export const pvArraysInput = z
  .array(
    z
      .object({
        id: z.string().min(1).max(40).optional(),
        name: z.string().trim().min(1).max(80),
        inverterId: z.string().min(1),
        kwp: z.number().positive().max(10_000),
        tiltDeg: z.number().min(0).max(90),
        azimuthDeg: z.number().min(0).max(360),
      })
      .strict()
  )
  .max(50);
export type PvArraysInput = z.infer<typeof pvArraysInput>;

/** PATCH /api/site/battery (owner, installer). */
export const batteryPatch = z
  .object({
    usableKwh: z.number().positive().max(100_000),
    maxKw: z.number().positive().max(100_000),
    floorPct: z.number().min(BATTERY_FLOOR_MIN_PCT, `The hardware minimum reserve must be at least ${BATTERY_FLOOR_MIN_PCT}%`).max(100),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type BatteryPatch = z.infer<typeof batteryPatch>;

const dateRange = z
  .object({ name: z.string().trim().min(1).max(80), start: localDate, end: localDate })
  .strict()
  .refine((r) => r.start <= r.end, { message: 'start must not be after end', path: ['end'] });

/** PUT /api/calendar (owner, manager): the whole calendar. */
export const calendarInput = z
  .object({
    terms: z.array(dateRange).max(20),
    daysOff: z.array(dateRange).max(100),
    open: hhmm,
    close: hhmm,
    weekends: z.enum(['closed', 'open']),
  })
  .strict()
  .refine((c) => c.open < c.close, { message: 'Opening time must be before closing time', path: ['close'] });
export type CalendarInput = z.infer<typeof calendarInput>;

export interface CalendarView extends CalendarInput {
  updatedAt: string | null;
}

export type CalendarDayType = 'open' | 'closed';

/**
 * Whether the building is in use on a local date: a weekday in a term and not a day off (or any
 * day of a term when weekends are open). Used by the load forecast and peak-shaving rules.
 */
export const calendarDayType = (cal: Pick<CalendarInput, 'terms' | 'daysOff' | 'weekends'>, date: string): CalendarDayType => {
  const within = (r: { start: string; end: string }) => date >= r.start && date <= r.end;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (cal.weekends === 'closed' && (dow === 0 || dow === 6)) return 'closed';
  if (cal.daysOff.some(within)) return 'closed';
  return cal.terms.some(within) ? 'open' : 'closed';
};

/** The App v2 demo calendar (Maple Grove School, 2026–27). */
export const DEMO_CALENDAR_INPUT: CalendarInput = {
  terms: [
    { name: 'Fall term', start: '2026-09-02', end: '2026-12-18' },
    { name: 'Winter term', start: '2027-01-05', end: '2027-03-12' },
    { name: 'Spring term', start: '2027-03-23', end: '2027-06-25' },
  ],
  daysOff: [
    { name: 'PA day', start: '2026-10-09', end: '2026-10-09' },
    { name: 'Thanksgiving', start: '2026-10-12', end: '2026-10-12' },
    { name: 'Winter break', start: '2026-12-21', end: '2027-01-01' },
  ],
  open: '07:30',
  close: '17:30',
  weekends: 'closed',
};

/**
 * Open or closed for a site: from its calendar when it has terms or days off, otherwise weekdays
 * open and weekends closed (the load forecast and the recommendation rules use this).
 */
export const siteDayClass = (date: string, calendar: Pick<CalendarInput, 'terms' | 'daysOff' | 'weekends'> | null): CalendarDayType => {
  if (calendar && (calendar.terms.length || calendar.daysOff.length)) return calendarDayType(calendar, date);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 'closed' : 'open';
};
