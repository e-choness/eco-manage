import { clearSkyGhi, hashRandom, pvKw, siteMinuteOfDay, siteDate, sunElevationDeg, weatherAt, type DemoDevice, type TelemetryReading } from '@ecomanage/shared';
import { DEMO_CALENDAR, dayType, type DayType, type SchoolCalendar } from './calendar';

// Physics of the simulated site (spec §7). Powers use the site sign convention: positive into the
// switchboard (PV, battery discharge, grid import), negative for loads. Every device integrates its
// own energy counters, so the meter's import/export equals the sum of the other devices.

export interface BatteryConfig {
  usableKwh: number;
  maxKw: number;
  reservePct: number;
  floorPct: number;
  roundTripEfficiency: number;
  initialSocPct: number;
}

export interface SiteConfig {
  tz: string;
  lat: number;
  lon: number;
  seed: number;
  devices: DemoDevice[];
  calendar?: SchoolCalendar;
  battery?: Partial<BatteryConfig>;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

const HOUR_S = 3600;
const COMMISSIONED_AT = Date.parse('2024-03-14T15:00:00Z'); // demo site, App v2
// Long-run average power per device type, used to age counters over time the simulator didn't run.
const AVERAGE_KW: Partial<Record<DemoDevice['type'], { in: number; out: number }>> = {
  pv: { in: 0, out: 6 },
  battery: { in: 4, out: 3.7 },
  meter: { in: 22, out: 1.2 },
  ev: { in: 3, out: 0 },
  heatpump: { in: 6, out: 0 },
};

export interface SimState {
  savedAt: string;
  socPct: number;
  counters: Record<string, { inKwh: number; outKwh: number }>;
}
const KW_PER_AMP = 22 / 32; // three-phase 230 V
const EV_DEFAULT_LIMIT_A = 32;
const BATTERY_DEFAULTS: BatteryConfig = {
  usableKwh: 200,
  maxKw: 60,
  reservePct: 20,
  floorPct: 10,
  roundTripEfficiency: 0.92,
  initialSocPct: 60,
};

interface Counters {
  inKwh: number;
  outKwh: number;
}

interface Override<T> {
  value: T;
  until: number | null; // epoch ms
}

interface EvSession {
  id: string;
  idTag: string;
  needKwh: number;
  deliveredKwh: number;
  startedAt: Date;
  leavesAt: number;
}

interface EvArrival {
  charger: string;
  minute: number;
  idTag: string;
  needKwh: number;
  stayMin: number;
}

const toMs = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
};

export class SiteEngine {
  readonly tz: string;
  readonly seed: number;
  readonly devices: Map<string, DemoDevice>;
  private readonly cal: SchoolCalendar;
  private battery: BatteryConfig;
  private readonly lat: number;
  private readonly lon: number;

  now: Date;
  private soc: number;
  private reserve: number;
  private readonly counters = new Map<string, Counters>();
  private readonly power = new Map<string, number>(); // latest p_kw per device, site sign
  private buildingKwh = 0;

  private batteryMode: Override<{ kind: 'force_discharge' | 'force_charge' | 'peak_shave'; kw: number }> | null = null;
  private readonly exportLimit = new Map<string, Override<number>>(); // pct of rating
  private readonly outputFactor = new Map<string, number>();
  private readonly evLimit = new Map<string, Override<number>>(); // amps
  private readonly evSchedule = new Map<string, { at: number; amps: number }[]>();
  private readonly sessions = new Map<string, EvSession>();
  private readonly startedToday = new Set<string>();
  private sgMode: Override<number> | null = null;
  private submeterKey: string | null = null;

  constructor(config: SiteConfig, start: Date) {
    this.tz = config.tz;
    this.lat = config.lat;
    this.lon = config.lon;
    this.seed = config.seed;
    this.cal = config.calendar ?? DEMO_CALENDAR;
    this.battery = { ...BATTERY_DEFAULTS, ...config.battery };
    this.devices = new Map(config.devices.map((d) => [d.key, d]));
    this.now = new Date(start);
    this.soc = this.battery.initialSocPct;
    this.reserve = this.battery.reservePct;
    // Lifetime counters as if the site had run at its average power since commissioning, so a
    // simulator restart later in time never makes a counter go backwards (real counters don't).
    const hoursRunning = Math.max(0, (start.getTime() - COMMISSIONED_AT) / 3_600_000);
    const since = (avgKw: number) => Math.round(avgKw * hoursRunning * 1000) / 1000;
    for (const d of config.devices) {
      const base = Math.round(hashRandom(this.seed, `counter:${d.key}`) * 1000);
      const avg = AVERAGE_KW[d.type];
      this.counters.set(d.key, avg ? { inKwh: avg.in ? base + since(avg.in) : 0, outKwh: avg.out ? base + since(avg.out) : 0 } : { inKwh: 0, outKwh: 0 });
      this.power.set(d.key, 0);
    }
  }

  // ---- environment --------------------------------------------------------------------------------

  dayType(): DayType {
    return dayType(this.now, this.tz, this.cal);
  }

  weather() {
    return weatherAt(this.now, this.tz, this.seed);
  }

  private minute(): number {
    return siteMinuteOfDay(this.now, this.tz);
  }

  /** Building load that isn't separately metered (lights, IT, kitchen, ventilation), kW. */
  buildingKw(): number {
    const m = this.minute();
    const type = this.dayType();
    const { open, close } = this.cal;
    let kw: number;
    if (type === 'weekend') kw = 28;
    else if (type === 'weekday-closed') kw = m >= 7 * 60 && m < 17 * 60 ? 48 : 32;
    else if (m < open - 60) kw = 34;
    else if (m < open) kw = 34 + ((m - (open - 60)) / 60) * 40;
    else if (m < 11 * 60) kw = 78;
    else if (m < 13 * 60 + 30) kw = 92; // kitchen and lunch
    else if (m < 15 * 60 + 30) kw = 86;
    else if (m < close) kw = 74;
    else if (m < 21 * 60) kw = 46;
    else kw = 34;
    const noise = (hashRandom(this.seed, `bld:${Math.floor(this.now.getTime() / 300_000)}`) - 0.5) * 0.08;
    return kw * (1 + noise);
  }

  /** Heat pump electrical load driven by outdoor temperature and SG-Ready mode, kW (positive). */
  heatPumpKw(): number {
    const hp = this.firstOfType('heatpump');
    if (!hp) return 0;
    const t = this.weather().tempC;
    const m = this.minute();
    const occupied = this.dayType() === 'school' && m >= this.cal.open - 60 && m <= this.cal.close;
    const rated = hp.ratedKw ?? 40;
    let kw = occupied ? 2 : 0;
    if (t > 20) kw = Math.min(rated, 3.5 * (t - 18)) * (occupied ? 1 : 0.35);
    else if (t < 13) kw = Math.min(rated, 3 * (18 - t)) * (occupied ? 1 : 0.5);
    switch (this.activeSgMode()) {
      case 1:
        return 0;
      case 3:
        return Math.min(rated, kw * 1.6 + 5);
      case 4:
        return rated;
      default:
        return kw;
    }
  }

  activeSgMode(): number {
    if (this.sgMode && (this.sgMode.until === null || this.now.getTime() < this.sgMode.until)) return this.sgMode.value;
    return 2;
  }

  /** PV output of one inverter, kW. */
  inverterKw(key: string): number {
    const d = this.devices.get(key);
    if (!d || d.type !== 'pv') return 0;
    const ghi = clearSkyGhi(sunElevationDeg(this.now, this.lat, this.lon));
    const minuteNoise = hashRandom(this.seed, `pv:${key}:${Math.floor(this.now.getTime() / 60_000)}`);
    const cloud = Math.min(1, this.weather().cloud * (0.94 + 0.12 * minuteNoise));
    let kw = pvKw(d.kwp ?? 0, ghi, cloud) * (this.outputFactor.get(key) ?? 1);
    const rated = d.ratedKw ?? Infinity;
    const limit = this.exportLimit.get(key);
    const cap = limit && (limit.until === null || this.now.getTime() < limit.until) ? (rated * limit.value) / 100 : rated;
    kw = Math.min(kw, cap);
    return Math.max(0, kw);
  }

  // ---- EV sessions --------------------------------------------------------------------------------

  private arrivals(): EvArrival[] {
    const type = this.dayType();
    const day = siteDate(this.now, this.tz);
    const r = (k: string) => hashRandom(this.seed, `${day}:${k}`);
    if (type === 'school') {
      return [
        { charger: 'ev1', minute: 9 * 60 + 10, idTag: 'BUS-2', needKwh: 15 + 10 * r('b2am'), stayMin: 5 * 60 },
        { charger: 'ev2', minute: 8 * 60 + Math.round(20 * r('c1')), idTag: 'STAFF-11', needKwh: 8 + 10 * r('c1k'), stayMin: 8 * 60 },
        { charger: 'ev3', minute: 8 * 60 + 30 + Math.round(30 * r('c2')), idTag: 'STAFF-07', needKwh: 6 + 6 * r('c2k'), stayMin: 7 * 60 },
        { charger: 'ev1', minute: 15 * 60 + 5, idTag: 'BUS-2', needKwh: 40 + 15 * r('b2pm'), stayMin: 16 * 60 },
        { charger: 'ev4', minute: 15 * 60 + 20, idTag: 'BUS-1', needKwh: 35 + 15 * r('b1pm'), stayMin: 16 * 60 },
      ];
    }
    return r('weekend-car') < 0.5 ? [{ charger: 'ev2', minute: 10 * 60, idTag: 'STAFF-11', needKwh: 10, stayMin: 3 * 60 }] : [];
  }

  private updateSessions(): void {
    const m = this.minute();
    const day = siteDate(this.now, this.tz);
    const nowMs = this.now.getTime();
    for (const [key, s] of this.sessions) {
      if (s.deliveredKwh >= s.needKwh || nowMs >= s.leavesAt) this.sessions.delete(key);
    }
    for (const a of this.arrivals()) {
      const tag = `${day}:${a.charger}:${a.minute}`;
      if (!this.devices.has(a.charger) || this.startedToday.has(tag) || m < a.minute || m > a.minute + 30) continue;
      if (this.sessions.has(a.charger)) continue;
      this.startedToday.add(tag);
      this.sessions.set(a.charger, {
        id: `${a.charger}-${nowMs}`,
        idTag: a.idTag,
        needKwh: a.needKwh,
        deliveredKwh: 0,
        startedAt: new Date(nowMs),
        leavesAt: nowMs + a.stayMin * 60_000,
      });
    }
  }

  evLimitA(key: string): number {
    const nowMs = this.now.getTime();
    const schedule = this.evSchedule.get(key);
    if (schedule?.length) {
      const current = schedule.filter((s) => s.at <= nowMs).at(-1);
      if (current) return current.amps;
    }
    const limit = this.evLimit.get(key);
    if (limit && (limit.until === null || nowMs < limit.until)) return limit.value;
    return EV_DEFAULT_LIMIT_A;
  }

  /** Charging power of one charger, kW (positive). */
  evKw(key: string): number {
    const s = this.sessions.get(key);
    const d = this.devices.get(key);
    if (!s || !d) return 0;
    return Math.min(d.ratedKw ?? 22, this.evLimitA(key) * KW_PER_AMP);
  }

  // ---- battery --------------------------------------------------------------------------------

  private batteryKw(netLoadKw: number, dtH: number): number {
    const { usableKwh, maxKw, roundTripEfficiency } = this.battery;
    const eff = Math.sqrt(roundTripEfficiency);
    const availableKwh = Math.max(0, ((this.soc - this.reserve) / 100) * usableKwh) * eff;
    const roomKwh = Math.max(0, ((100 - this.soc) / 100) * usableKwh) / eff;
    const discharge = (kw: number) => Math.max(0, Math.min(kw, maxKw, availableKwh / dtH));
    const charge = (kw: number) => -Math.max(0, Math.min(kw, maxKw, roomKwh / dtH));

    const mode = this.batteryMode && (this.batteryMode.until === null || this.now.getTime() < this.batteryMode.until) ? this.batteryMode.value : null;
    if (mode?.kind === 'force_discharge') return discharge(mode.kw);
    if (mode?.kind === 'force_charge') return charge(mode.kw);
    if (mode?.kind === 'peak_shave') return netLoadKw > mode.kw ? discharge(netLoadKw - mode.kw) : netLoadKw < 0 ? charge(-netLoadKw) : 0;

    // Default self-consumption: soak up solar surplus, and cover the evening load (17:00–22:00)
    // after the building closes. Afternoon peaks are left to the peak-shaving rule to propose.
    if (netLoadKw < 0) return charge(-netLoadKw);
    const m = this.minute();
    if (m >= 17 * 60 && m < 22 * 60) return discharge(netLoadKw);
    return 0;
  }

  // ---- stepping --------------------------------------------------------------------------------

  private firstOfType(type: DemoDevice['type']): DemoDevice | undefined {
    return [...this.devices.values()].find((d) => d.type === type);
  }

  // Counters follow the device's own terminals: e_in is import (meter) or energy taken in
  // (battery charge, loads); e_out is export (meter) or energy delivered (PV, battery discharge).
  // For the grid meter, positive site-sign power means import.
  private add(key: string, pKw: number, dtH: number): void {
    const c = this.counters.get(key);
    if (!c) return;
    const isMeter = this.devices.get(key)?.type === 'meter';
    const inward = isMeter ? pKw > 0 : pKw < 0;
    if (inward) c.inKwh += Math.abs(pKw) * dtH;
    else c.outKwh += Math.abs(pKw) * dtH;
    this.power.set(key, pKw + 0); // no -0 for idle loads
  }

  /** Advances the site by dtS seconds using the conditions at the start of the step. */
  step(dtS: number): void {
    const dtH = dtS / HOUR_S;
    this.updateSessions();

    let pv = 0;
    for (const d of this.devices.values()) {
      if (d.type !== 'pv') continue;
      const kw = this.inverterKw(d.key);
      this.add(d.key, kw, dtH);
      pv += kw;
    }
    let ev = 0;
    for (const d of this.devices.values()) {
      if (d.type !== 'ev') continue;
      const kw = this.evKw(d.key);
      const s = this.sessions.get(d.key);
      if (s) s.deliveredKwh += kw * dtH;
      this.add(d.key, -kw, dtH);
      ev += kw;
    }
    const hpKw = this.heatPumpKw();
    const hp = this.firstOfType('heatpump');
    if (hp) this.add(hp.key, -hpKw, dtH);
    const building = this.buildingKw();
    this.buildingKwh += building * dtH;
    if (this.submeterKey) this.add(this.submeterKey, -building * this.submeterShare(), dtH);

    const load = building + ev + hpKw;
    const bat = this.firstOfType('battery');
    const batteryKw = bat ? this.batteryKw(load - pv, dtH) : 0;
    if (bat) {
      const eff = Math.sqrt(this.battery.roundTripEfficiency);
      const deltaKwh = batteryKw > 0 ? -(batteryKw * dtH) / eff : -batteryKw * dtH * eff;
      this.soc = Math.min(100, Math.max(0, this.soc + (deltaKwh / this.battery.usableKwh) * 100));
      this.add(bat.key, batteryKw, dtH);
    }
    const meter = this.firstOfType('meter');
    if (meter) this.add(meter.key, load - pv - batteryKw, dtH);

    this.now = new Date(this.now.getTime() + dtS * 1000);
  }

  private submeterShare(): number {
    const m = this.minute();
    return m >= 11 * 60 && m < 13 * 60 + 30 ? 0.18 : 0.1; // kitchen circuits
  }

  // ---- readings --------------------------------------------------------------------------------

  /** A reading in the standard field set for one device at the current time. */
  reading(key: string): TelemetryReading | null {
    const d = this.devices.get(key);
    const c = this.counters.get(key);
    if (!d || !c || d.type === 'gateway') return null;
    const ts = this.now.toISOString();
    // Meters and inverters measure with some noise (class 0.5: ±0.25%). Counters integrate the
    // true power, so the noise never shows up in the energy balance.
    const measured = d.type === 'meter' || d.type === 'pv' ? 1 + (hashRandom(this.seed, `noise:${key}:${ts}`) - 0.5) * 0.005 : 1;
    const p = Math.round((this.power.get(key) ?? 0) * measured * 1000) / 1000 + 0; // + 0 turns -0 into 0
    const kwh = (v: number) => Math.round(v * 1000) / 1000;
    const phase = (kw: number) => Math.round((Math.abs(kw) * 1000) / (3 * 230) * 10) / 10;
    switch (d.type) {
      case 'pv':
        return {
          ts,
          p_kw: p,
          e_out_kwh: kwh(c.outKwh),
          state: p > 0.05 ? 'running' : 'sleeping',
          v: [231.2, 230.8, 232],
          a: [phase(p), phase(p), phase(p)],
          hz: 60,
          t_c: Math.round((22 + p * 0.5) * 10) / 10,
          q: 'ok',
        };
      case 'battery':
        return {
          ts,
          p_kw: p,
          e_in_kwh: kwh(c.inKwh),
          e_out_kwh: kwh(c.outKwh),
          soc_pct: Math.round(this.soc * 10) / 10,
          soh_pct: 97,
          reserve_pct: this.reserve,
          usable_kwh: this.battery.usableKwh,
          state: p > 0.05 ? 'discharging' : p < -0.05 ? 'charging' : 'idle',
          t_c: 27.4,
          q: 'ok',
        };
      case 'meter':
      case 'submeter':
        return { ts, p_kw: p, e_in_kwh: kwh(c.inKwh), e_out_kwh: kwh(c.outKwh), v: [230.9, 231.1, 231.6], a: [phase(p), phase(p), phase(p)], pf: 0.98, hz: 60, q: 'ok' };
      case 'ev': {
        const s = this.sessions.get(key);
        return {
          ts,
          p_kw: p,
          e_in_kwh: kwh(c.inKwh),
          state: s ? (p < -0.05 ? 'Charging' : 'SuspendedEVSE') : 'Available',
          limit_a: this.evLimitA(key),
          ...(s ? { session: { id: s.id, idTag: s.idTag, kwh: kwh(s.deliveredKwh), startedAt: s.startedAt.toISOString() } } : {}),
          q: 'ok',
        };
      }
      case 'heatpump': {
        const t = this.weather().tempC;
        const cooling = t > 20;
        return {
          ts,
          p_kw: p,
          e_in_kwh: kwh(c.inKwh),
          state: p < -0.05 ? (cooling ? 'cooling' : 'heating') : 'idle',
          sg_mode: this.activeSgMode(),
          supply_c: cooling ? 9.8 : 38,
          return_c: cooling ? 13.1 : 33,
          outdoor_c: Math.round(t * 10) / 10,
          q: 'ok',
        };
      }
      default:
        return null;
    }
  }

  // ---- inspection (tests, control API) ----------------------------------------------------------

  countersOf(key: string): Counters {
    const c = this.counters.get(key);
    return c ? { ...c } : { inKwh: 0, outKwh: 0 };
  }

  // ---- persistence across restarts -----------------------------------------------------------------

  /** Counters and battery charge, so a restarted simulator carries on like real hardware would. */
  saveState(): SimState {
    return {
      savedAt: this.now.toISOString(),
      socPct: this.soc,
      counters: Object.fromEntries([...this.counters].map(([k, c]) => [k, { ...c }])),
    };
  }

  /**
   * Resumes from saved state. Devices kept counting while the simulator was down, so the gap is
   * filled at each device's average power. State from the future (clock moved back) is ignored.
   */
  restoreState(state: SimState): boolean {
    const gapH = (this.now.getTime() - Date.parse(state.savedAt)) / 3_600_000;
    if (!Number.isFinite(gapH) || gapH < 0) return false;
    for (const [key, saved] of Object.entries(state.counters)) {
      const d = this.devices.get(key);
      if (!d) continue;
      const avg = AVERAGE_KW[d.type] ?? { in: 0, out: 0 };
      this.counters.set(key, { inKwh: saved.inKwh + avg.in * gapH, outKwh: saved.outKwh + avg.out * gapH });
    }
    this.soc = Math.min(100, Math.max(0, state.socPct));
    return true;
  }

  powerOf(key: string): number {
    return this.power.get(key) ?? 0;
  }

  buildingEnergyKwh(): number {
    return this.buildingKwh;
  }

  batteryState() {
    return { ...this.battery, socPct: this.soc, reservePct: this.reserve };
  }

  /** Hardware minimum reserve from the site config (P2-06). The reserve never sits below it. */
  setFloor(pct: number): void {
    this.battery = { ...this.battery, floorPct: pct };
    this.reserve = Math.max(this.reserve, pct);
  }

  // ---- control ------------------------------------------------------------------------------------

  setOutputFactor(key: string, factor: number): void {
    if (factor === 1) this.outputFactor.delete(key);
    else this.outputFactor.set(key, factor);
  }

  /** Adds a commissioned sub-meter measuring the kitchen circuits (part of the building load). */
  addSubmeter(device: DemoDevice): void {
    this.devices.set(device.key, device);
    this.counters.set(device.key, { inKwh: 0, outKwh: 0 });
    this.submeterKey = device.key;
    this.power.set(device.key, -this.buildingKw() * this.submeterShare());
  }

  /** Applies a validated command. Limits and expiry are checked by the gateway beforehand. */
  apply(key: string, action: string, params: Record<string, unknown>): CommandResult {
    const d = this.devices.get(key);
    if (!d) return { ok: false, error: `unknown device ${key}` };
    const until = toMs(params.until ?? params.validTo);
    switch (`${d.type}:${action}`) {
      case 'battery:set_reserve':
        this.reserve = Math.max(this.battery.floorPct, Number(params.pct));
        return { ok: true };
      case 'battery:force_discharge':
      case 'battery:force_charge':
        this.batteryMode = { value: { kind: action as 'force_discharge' | 'force_charge', kw: Number(params.kw) }, until };
        return { ok: true };
      case 'battery:peak_shave_target':
        this.batteryMode = { value: { kind: 'peak_shave', kw: Number(params.kw) }, until };
        return { ok: true };
      case 'battery:revert':
        this.batteryMode = null;
        return { ok: true };
      case 'pv:export_limit':
        this.exportLimit.set(key, { value: Number(params.pct), until });
        return { ok: true };
      case 'pv:revert':
        this.exportLimit.delete(key);
        return { ok: true };
      case 'ev:limit_current':
        this.evLimit.set(key, { value: Number(params.amps), until });
        return { ok: true };
      case 'ev:set_charging_profile': {
        const schedule = (params.schedule as { start: string; limitA: number }[] | undefined) ?? [];
        this.evSchedule.set(
          key,
          schedule.map((s) => ({ at: toMs(s.start) ?? 0, amps: Number(s.limitA) })).sort((a, b) => a.at - b.at)
        );
        return { ok: true };
      }
      case 'ev:remote_stop':
        this.sessions.delete(key);
        return { ok: true };
      case 'ev:revert':
        this.evLimit.delete(key);
        this.evSchedule.delete(key);
        return { ok: true };
      case 'heatpump:sg_mode':
        this.sgMode = { value: Number(params.mode), until };
        return { ok: true };
      case 'heatpump:revert':
        this.sgMode = null;
        return { ok: true };
      default:
        return { ok: true }; // restart, reset, change_availability …: acknowledged, nothing to simulate
    }
  }
}
