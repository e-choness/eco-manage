import mongoose, { InferSchemaType, Schema, Types } from 'mongoose';
import { RECOMMENDATION_STATUSES, ALERT_RULE_IDS, ALERT_SEVERITIES, ALERT_STATES, DEVICE_STATUSES, DEVICE_TYPES, QUALITY, ROLES } from '@ecomanage/shared';

// v2 data model (plan §2). Models are registered on the default mongoose connection; the app that
// imports them owns connecting. Collection names are given explicitly so they match the plan.

const { ObjectId } = Schema.Types;

// ---- sites -------------------------------------------------------------------------------------

const siteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: '' },
    tz: { type: String, required: true, default: 'UTC' },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    currency: { type: String, default: 'USD' },
    billDay: { type: Number, default: 1, min: 1, max: 28 },
    demandCapKw: { type: Number, default: null },
    gatewayId: { type: String, default: null },
    // Settings → Site (P2-06). Arrays feed the PV forecast; the battery's capacity and power live
    // on its device, the floor here (the gateway enforces it).
    pvArrays: {
      type: [
        new Schema(
          { id: String, name: String, inverterId: String, kwp: Number, tiltDeg: Number, azimuthDeg: Number },
          { _id: false }
        ),
      ],
      default: [],
    },
    batteryFloorPct: { type: Number, default: 10 },
    // Set when the gateway config could not be published; resent when the API reconnects.
    gatewayConfigPending: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export type SiteDoc = InferSchemaType<typeof siteSchema> & { _id: Types.ObjectId };
export const Site = mongoose.model('Site', siteSchema, 'sites');

// ---- people --------------------------------------------------------------------------------------

const membershipSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    siteId: { type: ObjectId, ref: 'Site', required: true },
    role: { type: String, enum: ROLES, required: true },
    until: { type: Date, default: null },
  },
  { timestamps: true }
);
membershipSchema.index({ userId: 1, siteId: 1 }, { unique: true });
membershipSchema.index({ siteId: 1 });
export type MembershipDoc = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId };
export const Membership = mongoose.model('Membership', membershipSchema, 'memberships');

const inviteSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    until: { type: Date, default: null },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
inviteSchema.index({ tokenHash: 1 });
export type InviteDoc = InferSchemaType<typeof inviteSchema> & { _id: Types.ObjectId };
export const Invite = mongoose.model('Invite', inviteSchema, 'invites');

// ---- devices -------------------------------------------------------------------------------------

const deviceSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    type: { type: String, enum: DEVICE_TYPES, required: true },
    name: { type: String, required: true, trim: true },
    profileId: { type: String, default: null },
    address: { type: String, default: '' },
    role: { type: String, default: '' },
    status: { type: String, enum: DEVICE_STATUSES, default: 'pending' },
    ratedKw: { type: Number, default: null },
    capacityKwh: { type: Number, default: null },
    lastSeenAt: { type: Date, default: null },
    commissionedAt: { type: Date, default: null },
    commissionedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
deviceSchema.index({ siteId: 1 });
export type DeviceDoc = InferSchemaType<typeof deviceSchema> & { _id: Types.ObjectId };
export const Device = mongoose.model('Device', deviceSchema, 'devices');

const deviceProfileSchema = new Schema(
  {
    id: { type: String, required: true }, // "sunspec-inverter@3"
    vendor: { type: String, required: true },
    model: { type: String, required: true },
    protocol: { type: String, required: true },
    deviceTypes: { type: [{ type: String, enum: DEVICE_TYPES }], required: true },
    // Validated by packages/profiles (register sources and protocol-message sources differ).
    fields: { type: [String], default: [] },
    read: { type: [Schema.Types.Mixed], default: [] },
    write: { type: Schema.Types.Mixed, default: {} },
    states: { type: Schema.Types.Mixed, default: {} },
    faults: { type: Schema.Types.Mixed, default: {} },
    fixes: { type: [Schema.Types.Mixed], default: [] },
    pollMs: { type: Number, default: 5000 },
    version: { type: Number, default: 1 },
    reviewed: { type: Boolean, default: false },
  },
  { timestamps: true }
);
deviceProfileSchema.index({ id: 1 }, { unique: true });
export type DeviceProfileDoc = InferSchemaType<typeof deviceProfileSchema> & { _id: Types.ObjectId };
export const DeviceProfile = mongoose.model('DeviceProfile', deviceProfileSchema, 'deviceProfiles');

// ---- telemetry (time series) ---------------------------------------------------------------------

export const TELEMETRY_TTL_SECONDS = 395 * 24 * 60 * 60; // 13 months

const telemetrySchema = new Schema(
  {
    ts: { type: Date, required: true },
    meta: {
      siteId: { type: ObjectId, required: true },
      deviceId: { type: ObjectId, required: true },
    },
    p_kw: { type: Number, required: true },
    e_in_kwh: Number,
    e_out_kwh: Number,
    soc_pct: Number,
    soh_pct: Number,
    reserve_pct: Number,
    usable_kwh: Number,
    state: String,
    fault: { type: [{ code: String, text: String, _id: false }], default: undefined },
    v: { type: [Number], default: undefined },
    a: { type: [Number], default: undefined },
    pf: Number,
    hz: Number,
    dc: { type: [{ v: Number, a: Number, _id: false }], default: undefined },
    t_c: Number,
    session: { id: String, idTag: String, kwh: Number, startedAt: Date },
    limit_a: Number,
    sg_mode: Number,
    supply_c: Number,
    return_c: Number,
    outdoor_c: Number,
    q: { type: String, enum: QUALITY, default: 'ok' },
  },
  {
    timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
    expireAfterSeconds: TELEMETRY_TTL_SECONDS,
    versionKey: false,
  }
);
telemetrySchema.index({ 'meta.deviceId': 1, ts: -1 });
telemetrySchema.index({ 'meta.siteId': 1, ts: -1 });
export type TelemetryDoc = InferSchemaType<typeof telemetrySchema> & { _id: Types.ObjectId };
export const Telemetry = mongoose.model('Telemetry', telemetrySchema, 'telemetry');

// ---- 15-minute intervals -------------------------------------------------------------------------

const intervalSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    start: { type: Date, required: true }, // UTC
    pv: { type: Number, default: 0 }, // kWh produced
    used: { type: Number, default: 0 }, // kWh of solar used on site
    batt: { type: Number, default: 0 }, // kWh, + discharge into the site, - charge
    grid: { type: Number, default: 0 }, // kWh imported
    export: { type: Number, default: 0 }, // kWh exported
    bld: { type: Number, default: 0 }, // kWh building remainder
    hp: { type: Number, default: 0 }, // kWh heat pump (positive)
    ev: { type: Number, default: 0 }, // kWh EV charging (positive)
    demandKw: { type: Number, default: 0 },
    costCents: { pk: { type: Number, default: 0 }, md: { type: Number, default: 0 }, op: { type: Number, default: 0 } },
    creditCents: { type: Number, default: 0 },
    quality: { type: String, enum: QUALITY, default: 'ok' },
    tariffVersion: { type: Number, default: null },
    // Set when the worker has priced this interval; ingest clears it when it recomputes one.
    costedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
intervalSchema.index({ costedAt: 1 });
intervalSchema.index({ siteId: 1, start: 1 }, { unique: true });
export type Interval15Doc = InferSchemaType<typeof intervalSchema> & { _id: Types.ObjectId };
export const Interval15 = mongoose.model('Interval15', intervalSchema, 'intervals15');

// ---- calendar ------------------------------------------------------------------------------------

// One per site (Settings → Calendar). The load forecast and peak-shaving rules read it.
const dateRangeSchema = new Schema({ name: String, start: String, end: String }, { _id: false });
const calendarSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    terms: { type: [dateRangeSchema], default: [] },
    daysOff: { type: [dateRangeSchema], default: [] },
    open: { type: String, default: '08:00' }, // local HH:mm, weekdays
    close: { type: String, default: '17:00' },
    weekends: { type: String, enum: ['closed', 'open'], default: 'closed' },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
calendarSchema.index({ siteId: 1 }, { unique: true });
export type CalendarDoc = InferSchemaType<typeof calendarSchema> & { _id: Types.ObjectId };
export const Calendar = mongoose.model('Calendar', calendarSchema, 'calendars');

// ---- tariffs ------------------------------------------------------------------------------------

// Versioned: saving creates version n+1 from its validFrom date; earlier versions are never edited
// (validation and pricing are in packages/shared/src/tariff.ts).
const tariffSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    version: { type: Number, required: true, min: 1 },
    validFrom: { type: String, required: true }, // local date YYYY-MM-DD in the site's zone
    name: { type: String, required: true },
    seasons: { type: [{ id: String, name: String, fromMonth: Number, toMonth: Number, _id: false }], default: [] },
    periods: {
      type: [{ name: String, season: String, days: String, start: String, end: String, rateCents: Number, _id: false }],
      required: true,
    },
    demandRateCents: { type: Number, required: true },
    demandIntervalMin: { type: Number, enum: [15, 30], required: true },
    exportRateCents: { type: Number, required: true },
    fixedCents: { type: Number, required: true },
    holidays: { dates: { type: [String], default: [] }, treatAs: { type: String, enum: ['weekend', 'weekday'], default: 'weekend' } },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
tariffSchema.index({ siteId: 1, version: 1 }, { unique: true });
export type TariffDoc = InferSchemaType<typeof tariffSchema> & { _id: Types.ObjectId };
export const Tariff = mongoose.model('Tariff', tariffSchema, 'tariffs');

// ---- bills -------------------------------------------------------------------------------------

// One per site and billing period (plan §2). Lines are whole cents; totalCents = energy lines +
// demand + fixed - export credit. Recomputed while the period is open and when late data arrives.
const billSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    period: { type: String, required: true }, // YYYY-MM of the period start (site time)
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    inProgress: { type: Boolean, default: true },
    lines: {
      energyPkCents: { type: Number, default: 0 },
      energyMdCents: { type: Number, default: 0 },
      energyOpCents: { type: Number, default: 0 },
      demandCents: { type: Number, default: 0 },
      fixedCents: { type: Number, default: 0 },
      exportCreditCents: { type: Number, default: 0 },
    },
    energyKwh: { pk: Number, md: Number, op: Number, export: Number },
    totalCents: { type: Number, default: 0 },
    peakKw: { type: Number, default: 0 },
    peakAt: { type: Date, default: null },
    tariffVersion: { type: Number, default: null }, // version for demand and fixed charges
    tariffVersions: { type: [Number], default: [] }, // every version used for energy
    intervals: { type: Number, default: 0 },
    estimatedShare: { type: Number, default: 0 },
    unpricedIntervals: { type: Number, default: 0 }, // days with no tariff in force
    // P2-04: against the same load bought entirely from the grid on the same tariff. Null until
    // the site has 7 days of intervals. savedCents = solar + battery + demand; baseline = total + saved.
    savedCents: { type: Number, default: null },
    savings: {
      type: new Schema(
        {
          baselineCents: Number,
          solarCents: Number, // solar used on site (incl. via the battery) + export credit
          batteryCents: Number, // buying cheap and using at dear periods (signed)
          demandCents: Number, // lower peak than the load alone would have set
          baselinePeakKw: Number,
        },
        { _id: false }
      ),
      default: null,
    },
    // P2-05: the utility's own bill for the period. An upload is read by the worker
    // (processing → done | failed); the owner can type the total in instead (manual).
    utility: {
      type: new Schema(
        {
          status: { type: String, enum: ['processing', 'done', 'failed', 'manual'] },
          totalCents: Number,
          diffCents: Number, // our total − the utility's
          source: { type: String, enum: ['pdf', 'csv', 'manual'] },
          fileId: String,
          fileName: String,
          error: String,
          uploadedBy: { type: ObjectId, ref: 'User' },
          parsedAt: Date,
        },
        { _id: false }
      ),
      default: null,
    },
    statement: { type: new Schema({ fileId: String, renderedAt: Date }, { _id: false }), default: null }, // cached PDF
    computedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
billSchema.index({ siteId: 1, period: 1 }, { unique: true });
export type BillDoc = InferSchemaType<typeof billSchema> & { _id: Types.ObjectId };
export const Bill = mongoose.model('Bill', billSchema, 'bills');

// ---- alerts, mutes, commands --------------------------------------------------------------------

// Opened and auto-resolved by apps/rules (P2-07); acked, snoozed and resolved by people (P2-08).
// At most one alert per (site, device, rule) is open or acked at a time.
const alertSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    deviceId: { type: String, default: null },
    ruleId: { type: String, enum: ALERT_RULE_IDS, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    title: { type: String, required: true },
    detail: { type: String, default: '' },
    state: { type: String, enum: ALERT_STATES, default: 'open' },
    condition: { type: String, enum: ['active', 'cleared'], default: 'active' },
    openedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    count: { type: Number, default: 1 }, // occurrences while open (event rules)
    eventKeys: { type: [String], default: [] }, // last occurrences seen (event rules)
    ackBy: { type: ObjectId, ref: 'User', default: null },
    ackAt: { type: Date, default: null },
    snoozedUntil: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolution: {
      type: new Schema({ cause: String, note: String, by: { type: ObjectId, ref: 'User' }, auto: Boolean }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true }
);
alertSchema.index({ siteId: 1, deviceId: 1, ruleId: 1, state: 1 });
// Enforces one live alert per (site, device, rule) even with two rules processes.
alertSchema.index(
  { siteId: 1, deviceId: 1, ruleId: 1 },
  { unique: true, partialFilterExpression: { state: { $in: ['open', 'ack'] } }, name: 'one_live_alert' }
);
alertSchema.index({ siteId: 1, openedAt: -1 });
export type AlertDoc = InferSchemaType<typeof alertSchema> & { _id: Types.ObjectId };
export const Alert = mongoose.model('Alert', alertSchema, 'alerts');

// A false alarm mutes its rule for the device for 7 days (P2-08). deviceId null mutes site-wide.
const ruleMuteSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    deviceId: { type: String, default: null },
    ruleId: { type: String, required: true },
    until: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User', default: null },
    alertId: { type: ObjectId, ref: 'Alert', default: null },
    // A false alarm flags the rule's threshold for review (Settings → Rules, P3-02).
    review: { type: Boolean, default: false },
  },
  { timestamps: true }
);
ruleMuteSchema.index({ siteId: 1, ruleId: 1, until: 1 });
export type RuleMuteDoc = InferSchemaType<typeof ruleMuteSchema> & { _id: Types.ObjectId };
export const RuleMute = mongoose.model('RuleMute', ruleMuteSchema, 'ruleMutes');

// Device maintenance log (App v2 device detail → Maintenance): visits an installer logs, and the
// cause and note of each alert someone resolves (P2-08).
const maintenanceSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    deviceId: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User', default: null },
    source: { type: String, enum: ['visit', 'alert'], required: true },
    text: { type: String, required: true },
    alertId: { type: ObjectId, ref: 'Alert', default: null },
  },
  { timestamps: true }
);
maintenanceSchema.index({ siteId: 1, deviceId: 1, at: -1 });
export type MaintenanceDoc = InferSchemaType<typeof maintenanceSchema> & { _id: Types.ObjectId };
export const Maintenance = mongoose.model('Maintenance', maintenanceSchema, 'maintenance');

// Device commands (plan §2). Created from approved recommendations or installer diagnostics
// (P3-04); the rules service watches acks and failures (P2-07).
const commandSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    deviceId: { type: String, required: true },
    recommendationId: { type: ObjectId, ref: 'Recommendation', default: null },
    alertId: { type: ObjectId, ref: 'Alert', default: null }, // a remote fix from an alert (P2-08)
    action: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
    revertAt: { type: Date, default: null },
    status: { type: String, enum: ['created', 'sent', 'acked', 'failed', 'verified', 'reverted', 'cancelled'], default: 'created' },
    sentAt: { type: Date, default: null },
    ackedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    error: { type: String, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
commandSchema.index({ siteId: 1, status: 1 });
export type CommandDoc = InferSchemaType<typeof commandSchema> & { _id: Types.ObjectId };
export const Command = mongoose.model('Command', commandSchema, 'commands');

// ---- notifications -------------------------------------------------------------------------------

// Settings → Notifications (P2-09): per person and site. No document means the defaults.
const notificationPrefsSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    siteId: { type: ObjectId, ref: 'Site', required: true },
    email: { type: String, required: true },
    alerts: { type: Boolean, default: true },
    daily: { type: Boolean, default: true },
    recs: { type: Boolean, default: true },
    failures: { type: Boolean, default: true },
    quietFrom: { type: String, default: '22:00' },
    quietTo: { type: String, default: '06:30' },
    escalateMin: { type: Number, default: 30 },
  },
  { timestamps: true }
);
notificationPrefsSchema.index({ userId: 1, siteId: 1 }, { unique: true });
export type NotificationPrefsDoc = InferSchemaType<typeof notificationPrefsSchema> & { _id: Types.ObjectId };
export const NotificationPrefs = mongoose.model('NotificationPrefs', notificationPrefsSchema, 'notificationPrefs');

// Every email sent. The unique key is claimed before sending, so a restart or a second worker
// never sends the same email twice: `alert:{alertId}:{userId}`, `escalation:{alertId}:{userId}`,
// `daily:{siteId}:{date}:{userId}`, `proposal:{recommendationId}:{userId}`.
const emailSchema = new Schema(
  {
    key: { type: String, required: true },
    siteId: { type: ObjectId, ref: 'Site', required: true },
    userId: { type: ObjectId, ref: 'User', default: null },
    kind: { type: String, enum: ['alert', 'escalation', 'daily', 'proposal'], required: true },
    alertId: { type: ObjectId, ref: 'Alert', default: null },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ['sending', 'sent'], default: 'sending' },
    sentAt: { type: Date, default: null },
    messageId: { type: String, default: null },
  },
  { timestamps: true }
);
emailSchema.index({ key: 1 }, { unique: true });
emailSchema.index({ siteId: 1, createdAt: -1 });
export type EmailDoc = InferSchemaType<typeof emailSchema> & { _id: Types.ObjectId };
export const Email = mongoose.model('Email', emailSchema, 'emails');

// ---- rules and recommendations -------------------------------------------------------------------

// Settings → Rules (P3-01): one document per site and rule overriding the App v2 defaults
// (RULE_DEFAULTS), plus one with ruleId "approval" holding the site's approval settings.
const ruleConfigSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    ruleId: { type: String, required: true },
    on: { type: Boolean, default: null },
    params: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
ruleConfigSchema.index({ siteId: 1, ruleId: 1 }, { unique: true });
export type RuleConfigDoc = InferSchemaType<typeof ruleConfigSchema> & { _id: Types.ObjectId };
export const RuleConfig = mongoose.model('RuleConfig', ruleConfigSchema, 'ruleConfigs');

// A proposed device action (plan §2, Backend Coverage §2). Created by the rules service or a
// person on the Devices page (ruleId "manual"); decided in the Inbox (P3-03).
const recommendationSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    ruleId: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    deviceId: { type: String, required: true },
    action: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    title: { type: String, required: true },
    window: { type: new Schema({ start: Date, end: Date }, { _id: false }), required: true },
    inputs: { type: [new Schema({ label: String, value: String }, { _id: false })], default: [] },
    checks: { type: [new Schema({ text: String, pass: Boolean }, { _id: false })], default: [] },
    calc: { type: String, default: '' },
    expectedSavingCents: { type: Number, default: 0 },
    status: { type: String, enum: RECOMMENDATION_STATUSES, default: 'proposed' },
    proposedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    decidedBy: { type: ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    declineReason: { type: String, default: null },
    commandId: { type: ObjectId, ref: 'Command', default: null },
    actualSavingCents: { type: Number, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null }, // manual requests
  },
  { timestamps: true }
);
recommendationSchema.index({ siteId: 1, status: 1 });
recommendationSchema.index({ dedupeKey: 1 });
// One open recommendation per dedupeKey, even if two rules processes run the same quarter.
recommendationSchema.index(
  { siteId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['proposed', 'approved', 'sent', 'acked'] } }, name: 'one_open_recommendation' }
);
export type RecommendationDoc = InferSchemaType<typeof recommendationSchema> & { _id: Types.ObjectId };
export const Recommendation = mongoose.model('Recommendation', recommendationSchema, 'recommendations');

// ---- forecasts -----------------------------------------------------------------------------------

// PV and load forecasts for the next 48 h in 15-minute steps (P2-10), issued every hour by the
// worker. The weather used goes with the PV forecast; accuracy is filled in a day later.
const forecastSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    kind: { type: String, enum: ['pv', 'load'], required: true },
    issuedAt: { type: Date, required: true },
    source: { type: String, required: true }, // weather source: simulated | open-meteo
    points: { type: [new Schema({ ts: Date, kw: Number }, { _id: false })], default: [] },
    weather: { type: [new Schema({ ts: Date, tempC: Number, cloud: Number }, { _id: false })], default: [] },
    // Load: which history each day was built from, e.g. "Thursday school-day profile (6 days)".
    profiles: { type: [new Schema({ date: String, label: String, days: Number }, { _id: false })], default: [] },
    accuracy: {
      type: new Schema({ mape: Number, n: Number, evaluatedAt: Date }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true }
);
forecastSchema.index({ siteId: 1, kind: 1, issuedAt: -1 });
forecastSchema.index({ issuedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
export type ForecastDoc = InferSchemaType<typeof forecastSchema> & { _id: Types.ObjectId };
export const Forecast = mongoose.model('Forecast', forecastSchema, 'forecasts');

// ---- audit ------------------------------------------------------------------------------------

const auditSchema = new Schema(
  {
    siteId: { type: ObjectId, ref: 'Site', required: true },
    userId: { type: ObjectId, ref: 'User', default: null }, // null for system actions
    action: { type: String, required: true },
    target: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ts: { type: Date, default: () => new Date() },
  },
  { versionKey: false }
);
auditSchema.index({ siteId: 1, ts: -1 });
export type AuditEventDoc = InferSchemaType<typeof auditSchema> & { _id: Types.ObjectId };
export const AuditEvent = mongoose.model('AuditEvent', auditSchema, 'auditEvents');

export const v2Models = [Site, Membership, Invite, Device, DeviceProfile, Telemetry, Interval15, Tariff, Bill, Calendar, Alert, RuleMute, Maintenance, Command, NotificationPrefs, Email, Forecast, RuleConfig, Recommendation, AuditEvent] as const;

/** Creates collections (the time-series one needs explicit creation) and indexes. */
export const initModels = async (): Promise<void> => {
  for (const m of v2Models) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err.codeName !== 'NamespaceExists') throw err;
    });
    await m.syncIndexes();
  }
};
