import type {
  ApprovalConfig,
  CalendarDayType,
  CalendarInput,
  Check,
  DemandNow,
  Proposal,
  RecommendationRuleId,
  Tariff,
  TelemetryReading,
} from '@ecomanage/shared';

// The recommendation rule framework (plan P3-01). A rule is three pure functions of the site's
// state at a quarter hour, so the same state always gives the same proposal, checks and saving.

export interface DeviceCtx {
  id: string;
  name: string;
  type: string;
  profileId: string | null;
  status: string;
  ratedKw: number | null;
  capacityKwh: number | null;
  latest: TelemetryReading | null;
}

export interface ForecastStep {
  ts: Date;
  pvKw: number | null;
  loadKw: number | null;
  netKw: number | null; // load − PV
  tempC: number | null;
  storm: boolean;
}

/**
 * Everything a rule may look at (Backend Coverage §2): latest telemetry, this billing period's
 * intervals, the PV and load forecast, the tariff in force today, the calendar, the site's limits
 * and the commands already running.
 */
export interface RecContext {
  now: Date; // the quarter hour being evaluated
  site: { id: string; name: string; tz: string; currency: string; demandCapKw: number | null };
  today: string; // local date
  dayClass: CalendarDayType;
  calendar: Pick<CalendarInput, 'terms' | 'daysOff' | 'weekends' | 'open' | 'close'> | null;
  tariff: Tariff | null;
  /** This billing period so far: the highest 15-minute demand. */
  period: { start: Date; end: Date; peakKw: number; peakAt: Date | null };
  demand: DemandNow | null;
  devices: DeviceCtx[];
  battery: { deviceId: string; socPct: number | null; reservePct: number | null; usableKwh: number | null; maxKw: number | null; floorPct: number } | null;
  forecast: ForecastStep[];
  commands: { id: string; deviceId: string; action: string; status: string; expiresAt: Date; revertAt: Date | null }[];
  /** EV sessions in progress, with the fleet vehicle (if any) and its usual energy per session. */
  evSessions: EvSession[];
  approval: ApprovalConfig;
}

/** The action as proposed or as adjusted before approval (the Inbox slider). */
export type Action = Pick<Proposal, 'deviceId' | 'params' | 'window'>;

export interface Rule<P = Record<string, number | boolean>> {
  id: RecommendationRuleId;
  /** Proposals (usually one; one per device when several need it), or null when nothing needs doing. */
  evaluate(ctx: RecContext, params: P): Proposal | Proposal[] | null;
  /** The safety and limit checks; all must pass to approve (they run again at approval). */
  check(ctx: RecContext, action: Action, params: P): Check[];
  /** Expected saving and the one-line worked sum shown in the Inbox. */
  saving(ctx: RecContext, action: Action, params: P): { cents: number; calc: string };
}

export interface EvSession {
  deviceId: string; // the charger
  chargerName: string;
  sessionId: string;
  idTag: string | null;
  deliveredKwh: number;
  startedAt: Date;
  chargingKw: number; // now (positive)
  ratedKw: number | null; // the charger's maximum
  vehicle: { name: string; departure: string; capacityKwh: number | null } | null;
  /** Average energy of the vehicle's last 10 sessions started at about this time of day. */
  typicalKwh: number | null;
  typicalFrom: number; // how many sessions that average is made of
}
