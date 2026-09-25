import type { Redis } from 'ioredis';
import { Calendar, Command, Device, Forecast, Interval15, Site, Tariff, type CalendarDoc, type CommandDoc, type DeviceDoc, type ForecastDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import { billingPeriod, siteDate, siteDayClass, tariffFromDoc, tariffOn, type ApprovalConfig, type DemandNow, type TelemetryReading } from '@ecomanage/shared';
import type { ForecastStep, RecContext } from './types';

// Loads a site's state for the recommendation rules at one quarter hour.

const OPEN_COMMANDS = ['created', 'sent', 'acked'];

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** The latest PV and load forecasts merged per step, from `now` on. */
const forecastFrom = (pv: ForecastDoc | null, load: ForecastDoc | null, now: Date): ForecastStep[] => {
  const steps = new Map<number, ForecastStep>();
  const at = (t: number) => {
    const s = steps.get(t) ?? { ts: new Date(t), pvKw: null, loadKw: null, netKw: null, tempC: null };
    steps.set(t, s);
    return s;
  };
  for (const p of pv?.points ?? []) if (p.ts! >= now) at(p.ts!.getTime()).pvKw = p.kw ?? null;
  for (const p of load?.points ?? []) if (p.ts! >= now) at(p.ts!.getTime()).loadKw = p.kw ?? null;
  for (const w of pv?.weather ?? []) if (w.ts! >= now) at(w.ts!.getTime()).tempC = w.tempC ?? null;
  return [...steps.values()]
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((s) => ({ ...s, netKw: s.loadKw !== null && s.pvKw !== null ? Math.round((s.loadKw - s.pvKw) * 100) / 100 : null }));
};

export const loadRecContext = async (
  siteId: string,
  now: Date,
  deps: { redis: Redis; demand: DemandNow | null; approval: ApprovalConfig }
): Promise<RecContext | null> => {
  const site = await Site.findById(siteId).lean<SiteDoc>();
  if (!site) return null;
  const period = billingPeriod(now, site.tz, site.billDay ?? 1);
  const [devices, calendar, tariffs, peak, pv, load, commands] = await Promise.all([
    Device.find({ siteId }).lean<DeviceDoc[]>(),
    Calendar.findOne({ siteId }).lean<CalendarDoc>(),
    Tariff.find({ siteId }).lean<TariffDoc[]>(),
    Interval15.findOne({ siteId, start: { $gte: period.start, $lt: now } }).sort({ demandKw: -1 }).select('start demandKw').lean<{ start: Date; demandKw: number }>(),
    Forecast.findOne({ siteId, kind: 'pv', issuedAt: { $lte: now } }).sort({ issuedAt: -1 }).lean<ForecastDoc>(),
    Forecast.findOne({ siteId, kind: 'load', issuedAt: { $lte: now } }).sort({ issuedAt: -1 }).lean<ForecastDoc>(),
    Command.find({ siteId, status: { $in: OPEN_COMMANDS } }).lean<CommandDoc[]>(),
  ]);
  const latest = devices.length ? await deps.redis.mget(...devices.map((d) => `latest:${d._id}`)) : [];
  const ctxDevices = devices.map((d, i) => ({
    id: String(d._id),
    name: d.name,
    type: d.type,
    profileId: d.profileId ?? null,
    status: d.status,
    ratedKw: d.ratedKw ?? null,
    capacityKwh: d.capacityKwh ?? null,
    latest: parse<TelemetryReading>(latest[i] ?? null),
  }));
  const bat = ctxDevices.find((d) => d.type === 'battery');
  const today = siteDate(now, site.tz);
  const cal = calendar
    ? { terms: calendar.terms as never, daysOff: calendar.daysOff as never, weekends: calendar.weekends as 'open' | 'closed', open: calendar.open, close: calendar.close }
    : null;
  return {
    now,
    site: { id: siteId, name: site.name, tz: site.tz, currency: site.currency ?? 'USD', demandCapKw: site.demandCapKw ?? null },
    today,
    dayClass: siteDayClass(today, cal),
    calendar: cal,
    tariff: tariffOn(tariffs.map(tariffFromDoc), today),
    period: { start: period.start, end: period.end, peakKw: peak?.demandKw ?? 0, peakAt: peak?.start ?? null },
    demand: deps.demand,
    devices: ctxDevices,
    battery: bat
      ? {
          deviceId: bat.id,
          socPct: bat.latest?.soc_pct ?? null,
          reservePct: bat.latest?.reserve_pct ?? null,
          usableKwh: bat.capacityKwh,
          maxKw: bat.ratedKw,
          floorPct: site.batteryFloorPct ?? 10,
        }
      : null,
    forecast: forecastFrom(pv, load, now),
    commands: commands.map((c) => ({ id: String(c._id), deviceId: c.deviceId, action: c.action, status: c.status, expiresAt: c.expiresAt, revertAt: c.revertAt ?? null })),
    approval: deps.approval,
  };
};
