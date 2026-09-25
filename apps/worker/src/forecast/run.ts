import { Calendar, Device, Forecast, Interval15, Site, type CalendarDoc, type DeviceDoc, type ForecastDoc, type SiteDoc } from '@ecomanage/db';
import { REFERENCE_ARRAY } from '@ecomanage/shared';
import { STEP_MS, horizon, loadForecast, mape, pvForecast, type ArrayInput, type LoadSlot } from './models';
import type { WeatherSource } from './weather';

// Issues a site's PV and load forecasts (plan P2-10) and scores yesterday's day-ahead forecast
// against what the meter saw (the MAPE is logged and kept on the forecast).

const HISTORY_DAYS = 42;
const MIN_HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;

type IntervalRow = { start: Date; grid: number; export: number; pv: number; batt: number };

/** Site consumption in kW over one interval (energy ÷ 0.25 h), never negative. */
const loadKw = (iv: IntervalRow) => Math.max(0, (iv.grid - iv.export + (iv.pv ?? 0) + (iv.batt ?? 0)) * 4);

/** Arrays from Settings → Site; a site without any uses each inverter's rating at the reference geometry. */
export const arraysOf = (site: SiteDoc, inverters: DeviceDoc[]): ArrayInput[] => {
  const arrays = (site.pvArrays ?? []).filter((a) => a.inverterId && a.kwp);
  if (arrays.length) return arrays.map((a) => ({ inverterId: a.inverterId!, kwp: a.kwp!, tiltDeg: a.tiltDeg ?? 10, azimuthDeg: a.azimuthDeg ?? 180 }));
  return inverters.filter((d) => d.ratedKw).map((d) => ({ inverterId: String(d._id), kwp: d.ratedKw!, ...REFERENCE_ARRAY }));
};

export interface ForecastRun {
  siteId: string;
  pv: boolean;
  load: boolean;
  reason?: string;
}

export const forecastSite = async (siteId: string, weather: WeatherSource, now = new Date()): Promise<ForecastRun> => {
  const site = await Site.findById(siteId).lean<SiteDoc>();
  if (!site) return { siteId, pv: false, load: false, reason: 'no such site' };
  if (site.lat == null || site.lon == null) return { siteId, pv: false, load: false, reason: 'the site has no location' };
  const loc = { lat: site.lat, lon: site.lon, tz: site.tz };

  const targets = horizon(now);
  const historyFrom = new Date(targets[0].getTime() - HISTORY_DAYS * DAY_MS);
  const [inverters, calendar, intervals] = await Promise.all([
    Device.find({ siteId, type: 'pv' }).lean<DeviceDoc[]>(),
    Calendar.findOne({ siteId }).lean<CalendarDoc>(),
    Interval15.find({ siteId, start: { $gte: historyFrom, $lt: now } }).select('start grid export pv batt').lean<IntervalRow[]>(),
  ]);
  const ahead = await weather.at(loc, targets);
  const base = { siteId, issuedAt: now, source: weather.name };

  let pv = false;
  const arrays = arraysOf(site, inverters);
  if (arrays.length) {
    const kw = pvForecast(site as { lat: number; lon: number }, arrays, new Map(inverters.map((d) => [String(d._id), d.ratedKw ?? null])), ahead);
    await Forecast.create({ ...base, kind: 'pv', points: targets.map((ts, i) => ({ ts, kw: kw[i] })), weather: ahead });
    pv = true;
  }

  const historyDays = new Set(intervals.map((iv) => Math.floor(iv.start.getTime() / DAY_MS))).size;
  if (historyDays < MIN_HISTORY_DAYS) return { siteId, pv, load: false, reason: `load needs ${MIN_HISTORY_DAYS} days of intervals (has ${historyDays})` };
  const past = await weather.at(loc, intervals.map((iv) => iv.start));
  const history: LoadSlot[] = intervals.map((iv, i) => ({ ts: iv.start, kw: loadKw(iv), tempC: past[i].tempC }));
  const cal = calendar ? { terms: calendar.terms as never, daysOff: calendar.daysOff as never, weekends: calendar.weekends as 'open' | 'closed' } : null;
  const load = loadForecast(ahead, history, site.tz, cal);
  await Forecast.create({
    ...base,
    kind: 'load',
    points: targets.map((ts, i) => ({ ts, kw: load.kw[i] })).filter((p) => p.kw !== null),
    profiles: load.profiles,
  });
  return { siteId, pv, load: true };
};

export interface Accuracy {
  siteId: string;
  kind: 'pv' | 'load';
  mape: number;
  n: number;
  issuedAt: Date;
}

/**
 * Scores the day-ahead forecasts: for each kind, the latest forecast issued at least 24 h ago
 * and not scored yet, over its points up to now. PV counts only daylight slots (actual output
 * at least 5% of the site's kWp); load counts every slot with at least 1 kW.
 */
export const scoreForecasts = async (siteId: string, now = new Date()): Promise<Accuracy[]> => {
  const out: Accuracy[] = [];
  for (const kind of ['pv', 'load'] as const) {
    const f = await Forecast.findOne({ siteId, kind, issuedAt: { $lte: new Date(now.getTime() - DAY_MS), $gt: new Date(now.getTime() - 2 * DAY_MS) }, accuracy: null })
      .sort({ issuedAt: -1 })
      .lean<ForecastDoc>();
    if (!f) continue;
    const until = new Date(f.issuedAt.getTime() + DAY_MS);
    const actual = await Interval15.find({ siteId, start: { $gte: f.issuedAt, $lt: until } }).select('start grid export pv batt').lean<IntervalRow[]>();
    const byTs = new Map(actual.map((iv) => [iv.start.getTime(), kind === 'pv' ? (iv.pv ?? 0) * 4 : loadKw(iv)]));
    const pairs = (f.points ?? []).flatMap((p) => {
      const a = byTs.get(p.ts!.getTime());
      return a === undefined || p.ts!.getTime() + STEP_MS > now.getTime() ? [] : [{ forecast: p.kw ?? 0, actual: a }];
    });
    let minActual = 1;
    if (kind === 'pv') {
      const site = await Site.findById(siteId).lean<SiteDoc>();
      const kwp = (site?.pvArrays ?? []).reduce((s, a) => s + (a.kwp ?? 0), 0) || 10;
      minActual = 0.05 * kwp;
    }
    const score = mape(pairs, minActual);
    await Forecast.updateOne({ _id: f._id }, { $set: { accuracy: { mape: score.mape, n: score.n, evaluatedAt: now } } });
    if (score.mape !== null) out.push({ siteId, kind, mape: score.mape, n: score.n, issuedAt: f.issuedAt });
  }
  return out;
};

export const forecastAll = async (weather: WeatherSource, now = new Date()) => {
  const runs: ForecastRun[] = [];
  const scores: Accuracy[] = [];
  for (const site of await Site.find().select('_id').lean()) {
    runs.push(await forecastSite(String(site._id), weather, now));
    scores.push(...(await scoreForecasts(String(site._id), now)));
  }
  return { runs, scores };
};
