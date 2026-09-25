import { buildingKw, type DeviceType } from './signs';
import type { TelemetryReading } from './mqtt';

// Live-view calculations shared by the API snapshot and the browser, which applies stream events
// to the snapshot it already has (Data and Device Audit §5).

/** A reading older than this is not used for live flows. */
export const LIVE_MAX_AGE_MS = 60_000;

export interface DemandInput {
  intervalStart: Date;
  now: Date;
  minutes?: number;
  startKwh: number; // meter import counter at the interval start
  nowKwh: number; // meter import counter now
  currentKw: number; // meter power now (site sign)
}

export interface DemandNow {
  intervalStart: string;
  soFarKw: number; // average import power since the interval started
  projectedKw: number; // if the current power holds until the interval ends
}

/**
 * 15-minute demand so far and projected, from the meter's import counter (Data and Device Audit
 * §5 "Demand now"). Early in the interval (under 30 s) the current power is the best estimate.
 */
export const demandNow = ({ intervalStart, now, minutes = 15, startKwh, nowKwh, currentKw }: DemandInput): DemandNow => {
  const totalH = minutes / 60;
  const elapsedH = Math.min(totalH, Math.max(0, (now.getTime() - intervalStart.getTime()) / 3_600_000));
  const importKw = Math.max(0, currentKw);
  const energy = Math.max(0, nowKwh - startKwh);
  const soFarKw = elapsedH * 3600 < 30 ? importKw : energy / elapsedH;
  const projectedKw = (energy + importKw * (totalH - elapsedH)) / totalH;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { intervalStart: intervalStart.toISOString(), soFarKw: r2(soFarKw), projectedKw: r2(projectedKw) };
};

export interface LiveDevice {
  id: string;
  type: DeviceType;
  latest: TelemetryReading | null;
}

export interface SiteFlows {
  pv: number;
  battery: number;
  grid: number | null; // null when the meter has no fresh reading
  ev: number;
  heatpump: number;
  building: number | null; // unmetered remainder, positive
  stale: string[]; // ids of devices whose latest reading is too old to count
}

const fresh = (d: LiveDevice, now: Date) => !!d.latest && now.getTime() - Date.parse(d.latest.ts) <= LIVE_MAX_AGE_MS;

/** Present power per source and consumer in the site sign convention (loads negative). */
export const siteFlows = (devices: LiveDevice[], now: Date): SiteFlows => {
  const sum = (type: DeviceType) =>
    devices.filter((d) => d.type === type && fresh(d, now)).reduce((s, d) => s + d.latest!.p_kw, 0);
  const meters = devices.filter((d) => d.type === 'meter');
  const meterFresh = meters.length > 0 && meters.every((m) => fresh(m, now));
  const flows = {
    pv: sum('pv'),
    battery: sum('battery'),
    grid: meterFresh ? sum('meter') : null,
    ev: sum('ev'),
    heatpump: sum('heatpump'),
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    pv: round(flows.pv),
    battery: round(flows.battery),
    grid: flows.grid === null ? null : round(flows.grid),
    ev: round(flows.ev),
    heatpump: round(flows.heatpump),
    building:
      flows.grid === null
        ? null
        : round(buildingKw({ pv: flows.pv, battery: flows.battery, meter: flows.grid, ev: flows.ev, heatpump: flows.heatpump, submeters: 0 })),
    stale: devices.filter((d) => d.type !== 'gateway' && !fresh(d, now)).map((d) => d.id),
  };
};

export interface BatteryLive {
  socPct: number | null;
  reservePct: number | null;
  usableKwh: number | null;
  pKw: number;
  minutesLeft: number | null;
}

/**
 * Time left while discharging: (SoC − reserve) × usable kWh × SoH ÷ current kW (App v2 audit fix:
 * uses the reserve and usable capacity). Null when charging or idle.
 */
export const batteryLive = (latest: TelemetryReading | null): BatteryLive => {
  if (!latest) return { socPct: null, reservePct: null, usableKwh: null, pKw: 0, minutesLeft: null };
  const { soc_pct: soc, reserve_pct: reserve, usable_kwh: usable, soh_pct: soh, p_kw: p } = latest;
  const minutesLeft =
    p > 0.05 && soc !== undefined && reserve !== undefined && usable !== undefined
      ? Math.max(0, Math.round((((soc - reserve) / 100) * usable * ((soh ?? 100) / 100) / p) * 60))
      : null;
  return { socPct: soc ?? null, reservePct: reserve ?? null, usableKwh: usable ?? null, pKw: p, minutesLeft };
};

// ---- stream events (Redis channel site:{siteId}:events, forwarded as SSE) -------------------------

export const siteEventsChannel = (siteId: string) => `site:${siteId}:events`;

export type SiteEvent =
  | { type: 'telemetry'; deviceId: string; reading: TelemetryReading }
  | { type: 'demand'; demand: DemandNow; quality: 'ok' | 'estimated' }
  | { type: 'device'; deviceId: string; status: string };
