import { Forecast, type ForecastDoc, type SiteDoc } from '@ecomanage/db';
import type { ForecastAccuracy, ForecastPoint, ForecastView } from '@ecomanage/shared';

// GET /api/forecast (plan P2-10, Backend Coverage: recommendation inputs, Home). The worker issues
// forecasts hourly; this returns the latest of each kind from the current 15-minute step on.

const STEP_MS = 15 * 60_000;

const latest = (siteId: SiteDoc['_id'], kind: 'pv' | 'load') =>
  Forecast.findOne({ siteId, kind }).sort({ issuedAt: -1 }).lean<ForecastDoc>();

const lastScore = async (siteId: SiteDoc['_id'], kind: 'pv' | 'load'): Promise<ForecastAccuracy | null> => {
  const f = await Forecast.findOne({ siteId, kind, 'accuracy.mape': { $ne: null } }).sort({ issuedAt: -1 }).select('issuedAt accuracy').lean<ForecastDoc>();
  return f?.accuracy?.mape != null ? { mape: f.accuracy.mape, n: f.accuracy.n ?? 0, issuedAt: f.issuedAt.toISOString() } : null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export const getForecast = async (site: SiteDoc, now = new Date()): Promise<ForecastView> => {
  const [pv, load, pvScore, loadScore] = await Promise.all([latest(site._id, 'pv'), latest(site._id, 'load'), lastScore(site._id, 'pv'), lastScore(site._id, 'load')]);
  const from = Math.floor(now.getTime() / STEP_MS) * STEP_MS;
  const steps = new Map<number, ForecastPoint>();
  const at = (t: number) => {
    const p = steps.get(t) ?? { ts: new Date(t).toISOString(), pvKw: null, loadKw: null, netKw: null, tempC: null, cloud: null, storm: null };
    steps.set(t, p);
    return p;
  };
  for (const p of pv?.points ?? []) if (p.ts!.getTime() >= from) at(p.ts!.getTime()).pvKw = p.kw ?? null;
  for (const p of load?.points ?? []) if (p.ts!.getTime() >= from) at(p.ts!.getTime()).loadKw = p.kw ?? null;
  for (const w of pv?.weather ?? [])
    if (w.ts!.getTime() >= from)
      Object.assign(at(w.ts!.getTime()), { tempC: w.tempC != null ? Math.round(w.tempC * 10) / 10 : null, cloud: w.cloud != null ? r2(w.cloud) : null, storm: w.storm ?? false });
  const points = [...steps.values()]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((p) => ({ ...p, netKw: p.loadKw !== null && p.pvKw !== null ? r2(p.loadKw - p.pvKw) : null }));
  return {
    issuedAt: { pv: pv?.issuedAt.toISOString() ?? null, load: load?.issuedAt.toISOString() ?? null },
    source: pv?.source ?? load?.source ?? null,
    points,
    profiles: (load?.profiles ?? []).map((p) => ({ date: p.date!, label: p.label!, days: p.days ?? 0 })),
    accuracy: { pv: pvScore, load: loadScore },
  };
};
