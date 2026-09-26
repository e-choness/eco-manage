import mongoose from 'mongoose';
import type { Redis } from 'ioredis';
import {
  Calendar,
  Command,
  Device,
  FleetVehicle,
  Forecast,
  Interval15,
  Site,
  Tariff,
  Telemetry,
  type CalendarDoc,
  type CommandDoc,
  type DeviceDoc,
  type FleetVehicleDoc,
  type ForecastDoc,
  type SiteDoc,
  type TariffDoc,
} from '@ecomanage/db';
import { billingPeriod, siteDate, siteDayClass, siteMinuteOfDay, tariffFromDoc, tariffOn, type ApprovalConfig, type DemandNow, type TelemetryReading } from '@ecomanage/shared';
import type { DeviceCtx, EvSession, ForecastStep, RecContext } from './types';
import { currentDemand } from './demand';

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
    const s = steps.get(t) ?? { ts: new Date(t), pvKw: null, loadKw: null, netKw: null, tempC: null, storm: false };
    steps.set(t, s);
    return s;
  };
  for (const p of pv?.points ?? []) if (p.ts! >= now) at(p.ts!.getTime()).pvKw = p.kw ?? null;
  for (const p of load?.points ?? []) if (p.ts! >= now) at(p.ts!.getTime()).loadKw = p.kw ?? null;
  for (const w of pv?.weather ?? []) if (w.ts! >= now) Object.assign(at(w.ts!.getTime()), { tempC: w.tempC ?? null, storm: !!w.storm });
  return [...steps.values()]
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((s) => ({ ...s, netKw: s.loadKw !== null && s.pvKw !== null ? Math.round((s.loadKw - s.pvKw) * 100) / 100 : null }));
};

export const loadRecContext = async (
  siteId: string,
  now: Date,
  /** `demand`: the latest demand event when the caller has one; otherwise worked out from the meter. */
  deps: { redis: Redis; demand?: DemandNow | null; approval: ApprovalConfig }
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
  const meter = ctxDevices.find((d) => d.type === 'meter');
  const demand = deps.demand ?? (meter ? await currentDemand(meter.id, meter.latest, site.tz) : null);
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
    demand,
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
    evSessions: await loadEvSessions(siteId, now, site.tz, ctxDevices),
    approval: deps.approval,
  };
};

const TYPICAL_SESSIONS = 10;
const TYPICAL_WINDOW_MIN = 120; // sessions started within ±2 h of this one's time of day
const HISTORY_DAYS = 60;

/** Minutes between two local times of day, the short way round midnight. */
const clockGap = (a: Date, b: Date, tz: string) => {
  const d = Math.abs(siteMinuteOfDay(a, tz) - siteMinuteOfDay(b, tz));
  return Math.min(d, 1440 - d);
};

/**
 * EV sessions in progress (from the chargers' latest readings), with the fleet vehicle their RFID
 * belongs to and how much energy that vehicle usually takes at this time of day.
 */
export const loadEvSessions = async (siteId: string, now: Date, tz: string, chargers: DeviceCtx[]): Promise<EvSession[]> => {
  const active = chargers.filter((d) => d.type === 'ev' && d.latest?.session);
  if (!active.length) return [];
  const tags = [...new Set(active.map((d) => d.latest!.session!.idTag).filter((t): t is string => !!t))];
  const [fleet, past] = await Promise.all([
    FleetVehicle.find({ siteId, rfid: { $in: tags } }).lean<FleetVehicleDoc[]>(),
    tags.length
      ? Telemetry.aggregate<{ _id: string; idTag: string; kwh: number; startedAt: Date | string }>([
          { $match: { 'meta.siteId': new mongoose.Types.ObjectId(siteId), 'session.idTag': { $in: tags }, ts: { $gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000), $lt: now } } },
          { $group: { _id: '$session.id', idTag: { $first: '$session.idTag' }, kwh: { $max: '$session.kwh' }, startedAt: { $first: '$session.startedAt' } } },
        ])
      : Promise.resolve([]),
  ]);
  return active.map((d) => {
    const s = d.latest!.session!;
    const startedAt = new Date(s.startedAt);
    const similar = past
      .filter((p) => p.idTag === s.idTag && p._id !== s.id && clockGap(new Date(p.startedAt), startedAt, tz) <= TYPICAL_WINDOW_MIN)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, TYPICAL_SESSIONS);
    const v = fleet.find((f) => f.rfid === s.idTag);
    return {
      deviceId: d.id,
      chargerName: d.name,
      sessionId: s.id,
      idTag: s.idTag ?? null,
      deliveredKwh: s.kwh,
      startedAt,
      chargingKw: Math.max(0, -(d.latest!.p_kw ?? 0)),
      ratedKw: d.ratedKw,
      vehicle: v ? { name: v.name, departure: v.departure, capacityKwh: v.capacityKwh ?? null } : null,
      typicalKwh: similar.length ? Math.round((similar.reduce((a, p) => a + p.kwh, 0) / similar.length) * 10) / 10 : null,
      typicalFrom: similar.length,
    };
  });
};
