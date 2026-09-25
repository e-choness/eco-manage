import mongoose, { InferSchemaType, Schema, Types } from 'mongoose';
import { DEVICE_STATUSES, DEVICE_TYPES, QUALITY, ROLES } from '@ecomanage/shared';

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

export const v2Models = [Site, Membership, Invite, Device, DeviceProfile, Telemetry, Interval15, Tariff, Bill, AuditEvent] as const;

/** Creates collections (the time-series one needs explicit creation) and indexes. */
export const initModels = async (): Promise<void> => {
  for (const m of v2Models) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err.codeName !== 'NamespaceExists') throw err;
    });
    await m.syncIndexes();
  }
};
