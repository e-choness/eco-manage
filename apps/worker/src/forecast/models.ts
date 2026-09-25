import {
  arrayFactor,
  calendarDayType,
  clearSkyGhi,
  pvKw,
  siteDate,
  siteMinuteOfDay,
  sunElevationDeg,
  type CalendarInput,
} from '@ecomanage/shared';
import type { WeatherPoint } from './weather';

// The forecast models (plan P2-10). Pure: the caller loads history, weather and settings.

export const STEP_MS = 15 * 60_000;
export const HORIZON_STEPS = 48 * 4;

/** The next 48 h in 15-minute steps, starting at the next interval boundary. */
export const horizon = (now: Date): Date[] => {
  const first = Math.ceil(now.getTime() / STEP_MS) * STEP_MS;
  return Array.from({ length: HORIZON_STEPS }, (_, i) => new Date(first + i * STEP_MS));
};

// ---- PV ------------------------------------------------------------------------------------------

export interface ArrayInput {
  inverterId: string;
  kwp: number;
  tiltDeg: number;
  azimuthDeg: number;
}

/**
 * Expected PV output at each instant: the shared clear-sky model × the weather's cloud factor ×
 * each array's geometry, summed per inverter and capped at its rating.
 */
export const pvForecast = (
  site: { lat: number; lon: number },
  arrays: ArrayInput[],
  inverterKw: Map<string, number | null>,
  weather: WeatherPoint[]
): number[] =>
  weather.map(({ ts, cloud }) => {
    const ghi = clearSkyGhi(sunElevationDeg(ts, site.lat, site.lon));
    if (ghi === 0) return 0;
    const perInverter = new Map<string, number>();
    for (const a of arrays)
      perInverter.set(a.inverterId, (perInverter.get(a.inverterId) ?? 0) + pvKw(a.kwp, ghi, cloud) * arrayFactor(ts, site.lat, site.lon, a.tiltDeg, a.azimuthDeg));
    let total = 0;
    for (const [id, kw] of perInverter) total += Math.min(kw, inverterKw.get(id) ?? Infinity);
    return Math.round(total * 100) / 100;
  });

// ---- load ----------------------------------------------------------------------------------------

export interface LoadSlot {
  ts: Date;
  kw: number; // site consumption = grid − export + PV + battery, as average kW over the 15 minutes
  tempC: number;
}

type DayClass = 'open' | 'closed';

/** Degrees outside the band where the building needs neither heating nor cooling. */
export const degreesOutside = (tempC: number): number => Math.max(0, tempC - 20) + Math.max(0, 13 - tempC);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * Open or closed: from the site calendar when there is one (terms, days off, weekends), otherwise
 * weekdays open and weekends closed.
 */
export const dayClassOf = (date: string, calendar: Pick<CalendarInput, 'terms' | 'daysOff' | 'weekends'> | null): DayClass => {
  if (calendar && (calendar.terms.length || calendar.daysOff.length)) return calendarDayType(calendar, date);
  const dow = weekdayOf(date);
  return dow === 0 || dow === 6 ? 'closed' : 'open';
};

export interface LoadForecast {
  kw: (number | null)[];
  profiles: { date: string; label: string; days: number }[];
  sensitivity: number; // fitted share of load per degree outside the comfort band
}

const MIN_SAME_WEEKDAY = 2;
const SENSITIVITY_MAX = 0.1;

/**
 * Load for each target instant: the average of the same local time on history days of the same
 * weekday and calendar class (open or closed), from the last 6 weeks; with fewer than two such
 * days, all days of the same class. Then × a temperature factor: 1 + s × (degrees outside the
 * comfort band now − on the history days), where s is fitted from the history itself.
 */
export const loadForecast = (
  targets: WeatherPoint[],
  history: LoadSlot[],
  tz: string,
  calendar: Pick<CalendarInput, 'terms' | 'daysOff' | 'weekends'> | null
): LoadForecast => {
  // date → minute of day → slot
  const days = new Map<string, Map<number, LoadSlot>>();
  for (const s of history) {
    const date = siteDate(s.ts, tz);
    const byMinute = days.get(date) ?? new Map<number, LoadSlot>();
    byMinute.set(siteMinuteOfDay(s.ts, tz), s);
    days.set(date, byMinute);
  }
  const classOf = new Map([...days.keys()].map((d) => [d, dayClassOf(d, calendar)]));

  // Fit the temperature sensitivity: relative deviation from the class average at that minute,
  // against degrees outside the band relative to that minute's average.
  const classMinute = new Map<string, { kw: number; dd: number; n: number }>();
  for (const [date, byMinute] of days)
    for (const [m, s] of byMinute) {
      const k = `${classOf.get(date)}|${m}`;
      const acc = classMinute.get(k) ?? { kw: 0, dd: 0, n: 0 };
      acc.kw += s.kw;
      acc.dd += degreesOutside(s.tempC);
      acc.n++;
      classMinute.set(k, acc);
    }
  let sxy = 0;
  let sxx = 0;
  for (const [date, byMinute] of days)
    for (const [m, s] of byMinute) {
      const avg = classMinute.get(`${classOf.get(date)}|${m}`)!;
      if (avg.n < 2 || avg.kw <= 0) continue;
      const x = degreesOutside(s.tempC) - avg.dd / avg.n;
      sxy += (s.kw / (avg.kw / avg.n) - 1) * x;
      sxx += x * x;
    }
  const sensitivity = sxx > 1 ? Math.min(SENSITIVITY_MAX, Math.max(0, sxy / sxx)) : 0;

  const candidatesFor = new Map<string, string[]>();
  const profiles: LoadForecast['profiles'] = [];
  const pick = (date: string): string[] => {
    const cached = candidatesFor.get(date);
    if (cached) return cached;
    const cls = dayClassOf(date, calendar);
    const sameClass = [...days.keys()].filter((d) => classOf.get(d) === cls);
    const sameWeekday = sameClass.filter((d) => weekdayOf(d) === weekdayOf(date));
    const chosen = sameWeekday.length >= MIN_SAME_WEEKDAY ? sameWeekday : sameClass;
    const kind = cls === 'open' ? 'open-day' : 'closed-day';
    profiles.push({
      date,
      label: chosen === sameWeekday ? `${WEEKDAYS[weekdayOf(date)]} ${kind} profile` : `${kind} profile (all weekdays)`,
      days: chosen.length,
    });
    candidatesFor.set(date, chosen);
    return chosen;
  };

  const kw = targets.map(({ ts, tempC }) => {
    const chosen = pick(siteDate(ts, tz));
    const m = siteMinuteOfDay(ts, tz);
    const slots = chosen.map((d) => days.get(d)!.get(m)).filter((s): s is LoadSlot => !!s);
    if (!slots.length) return null;
    const base = slots.reduce((a, s) => a + s.kw, 0) / slots.length;
    const ddHist = slots.reduce((a, s) => a + degreesOutside(s.tempC), 0) / slots.length;
    return Math.round(Math.max(0, base * (1 + sensitivity * (degreesOutside(tempC) - ddHist))) * 100) / 100;
  });
  return { kw, profiles, sensitivity };
};

// ---- accuracy ------------------------------------------------------------------------------------

/** Mean absolute percentage error over the pairs whose actual value is at least `minActual`. */
export const mape = (pairs: { forecast: number; actual: number }[], minActual: number): { mape: number | null; n: number } => {
  const used = pairs.filter((p) => p.actual >= minActual);
  if (!used.length) return { mape: null, n: 0 };
  const sum = used.reduce((s, p) => s + Math.abs(p.forecast - p.actual) / p.actual, 0);
  return { mape: Math.round((sum / used.length) * 1000) / 10, n: used.length };
};
