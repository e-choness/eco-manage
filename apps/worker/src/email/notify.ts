import mongoose, { type Types } from 'mongoose';
import {
  Alert,
  Email,
  Interval15,
  Membership,
  Recommendation,
  RuleConfig,
  NotificationPrefs,
  Site,
  Tariff,
  type AlertDoc,
  type MembershipDoc,
  type NotificationPrefsDoc,
  type RecommendationDoc,
  type RuleConfigDoc,
  type SiteDoc,
  type TariffDoc,
} from '@ecomanage/db';
import {
  APPROVAL_DEFAULTS,
  DAILY_SUMMARY_AT,
  DEFAULT_NOTIFICATION_PREFS,
  computeBill,
  inQuietHours,
  siteClock,
  siteDate,
  siteDateStart,
  tariffFromDoc,
  type IntervalLike,
  type NotificationPrefs as Prefs,
  type ApprovalConfig,
} from '@ecomanage/shared';
import type { Mailer, Message } from './mailer';
import { alertEmail, dailyEmail, escalationEmail, proposalEmail, type DailySummary } from './templates';

// Alert emails, escalation and the daily summary (plan P2-09). Runs every 30 s from the worker;
// everything it sends is claimed in `emails` first, so each email goes out once.

/** Alerts older than this are not emailed any more (e.g. after a long worker outage). */
const ALERT_EMAIL_WINDOW_MS = 24 * 3600_000;
const ALWAYS_FAILURES = ['owner', 'manager'];

export interface Recipient {
  userId: string;
  name: string;
  role: string;
  prefs: Prefs;
}

type UserLean = { _id: Types.ObjectId; email: string; name?: string };

// Users live in the API's model; the worker only reads their names and addresses.
const mongooseUsers = () =>
  mongoose.models.User ?? mongoose.model('User', new mongoose.Schema({ email: String, name: String }, { strict: false }), 'users');

/** Current members of a site with their notification settings (defaults when none are saved). */
export const recipients = async (siteId: string, now: Date): Promise<Recipient[]> => {
  const members = await Membership.find({ siteId, $or: [{ until: null }, { until: { $gt: now } }] }).lean<MembershipDoc[]>();
  if (!members.length) return [];
  const users = mongooseUsers();
  const [people, prefs] = await Promise.all([
    users.find({ _id: { $in: members.map((m) => m.userId) } }).select('email name').lean<UserLean[]>(),
    NotificationPrefs.find({ siteId, userId: { $in: members.map((m) => m.userId) } }).lean<NotificationPrefsDoc[]>(),
  ]);
  const out: Recipient[] = [];
  for (const m of members) {
    const u = people.find((p) => String(p._id) === String(m.userId));
    if (!u) continue;
    const p = prefs.find((x) => String(x.userId) === String(m.userId));
    out.push({
      userId: String(u._id),
      name: u.name || u.email,
      role: m.role,
      prefs: p
        ? { email: p.email, alerts: p.alerts, daily: p.daily, recs: p.recs, failures: p.failures, quietFrom: p.quietFrom ?? null, quietTo: p.quietTo ?? null, escalateMin: p.escalateMin }
        : { email: u.email, ...DEFAULT_NOTIFICATION_PREFS },
    });
  }
  return out;
};

/**
 * Sends once per key: the claim is written first (unique index), the mail sent, then marked sent.
 * A failed send drops the claim so the next pass tries again. Returns whether it sent now.
 */
export const sendOnce = async (
  mailer: Mailer,
  claim: { key: string; siteId: string; userId: string | null; kind: 'alert' | 'escalation' | 'daily' | 'proposal'; alertId?: string },
  message: Message,
  now: Date
): Promise<boolean> => {
  try {
    await Email.create({ ...claim, to: message.to, subject: message.subject });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // already sent (or being sent)
    throw err;
  }
  try {
    const messageId = await mailer.send(message);
    await Email.updateOne({ key: claim.key }, { $set: { status: 'sent', sentAt: now, messageId } });
    return true;
  } catch (err) {
    await Email.deleteOne({ key: claim.key, status: 'sending' });
    throw err;
  }
};

const emailed = (a: Pick<AlertDoc, 'severity' | 'ruleId'>) => a.ruleId === 'command-failed' || a.severity !== 'info';

export interface NotifyResult {
  alerts: number;
  escalations: number;
}

/**
 * Emails new warnings and failures to each member who wants them, and escalates alerts nobody
 * acknowledged in time to the owner. Paused alerts (snoozed) send nothing. Warnings wait until
 * the recipient's quiet hours end; command failures always send.
 */
export const notifyAlerts = async (mailer: Mailer, appUrl: string, now = new Date()): Promise<NotifyResult> => {
  const result: NotifyResult = { alerts: 0, escalations: 0 };
  const alerts = await Alert.find({ state: { $in: ['open', 'ack'] }, openedAt: { $gte: new Date(now.getTime() - ALERT_EMAIL_WINDOW_MS) } }).lean<AlertDoc[]>();
  const bySite = new Map<string, AlertDoc[]>();
  for (const a of alerts.filter(emailed)) bySite.set(String(a.siteId), [...(bySite.get(String(a.siteId)) ?? []), a]);

  for (const [siteId, list] of bySite) {
    const site = await Site.findById(siteId).lean<SiteDoc>();
    if (!site) continue;
    const people = await recipients(siteId, now);
    for (const a of list) {
      if (a.snoozedUntil && a.snoozedUntil > now) continue;
      const failure = a.ruleId === 'command-failed';
      for (const r of people) {
        const wants = failure ? r.prefs.failures || ALWAYS_FAILURES.includes(r.role) : r.prefs.alerts;
        if (!wants || (!failure && inQuietHours(now, site.tz, r.prefs.quietFrom, r.prefs.quietTo))) continue;
        const key = `alert:${a._id}:${r.userId}`;
        if (await sendOnce(mailer, { key, siteId, userId: r.userId, kind: 'alert', alertId: String(a._id) }, alertEmail(site, a, r, appUrl), now)) result.alerts++;
      }
      // Escalation: still not acknowledged after the owner's limit.
      if (a.state !== 'open') continue;
      for (const r of people.filter((p) => p.role === 'owner')) {
        if (now.getTime() - a.openedAt.getTime() < r.prefs.escalateMin * 60_000) continue;
        if (!failure && inQuietHours(now, site.tz, r.prefs.quietFrom, r.prefs.quietTo)) continue;
        const key = `escalation:${a._id}:${r.userId}`;
        if (await sendOnce(mailer, { key, siteId, userId: r.userId, kind: 'escalation', alertId: String(a._id) }, escalationEmail(site, a, r, appUrl, now), now))
          result.escalations++;
      }
    }
  }
  return result;
};

const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Yesterday's cost, peak and savings for a site (energy only; demand is per billing period). */
export const summarizeDay = async (site: SiteDoc, date: string, now: Date): Promise<DailySummary> => {
  const start = siteDateStart(date, site.tz);
  const end = siteDateStart(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), site.tz);
  const [intervals, tariffs, openAlerts] = await Promise.all([
    Interval15.find({ siteId: site._id, start: { $gte: start, $lt: end } }).select('start grid export pv batt demandKw quality').lean<IntervalLike[]>(),
    Tariff.find({ siteId: site._id }).lean<TariffDoc[]>(),
    Alert.find({ siteId: site._id, state: { $in: ['open', 'ack'] } }).sort({ openedAt: -1 }).lean<AlertDoc[]>(),
  ]);
  const b = computeBill({ period: date, start, end }, intervals, tariffs.map(tariffFromDoc), site.tz, now, true);
  const peak = intervals.reduce<IntervalLike | null>((m, iv) => (!m || iv.demandKw > m.demandKw ? iv : m), null);
  return {
    date,
    intervals: intervals.length,
    costCents: b.lines.energyPkCents + b.lines.energyMdCents + b.lines.energyOpCents - b.lines.exportCreditCents,
    gridKwh: Math.round(b.energyKwh.pk + b.energyKwh.md + b.energyKwh.op),
    peak: peak ? { kw: Math.round(peak.demandKw), at: peak.start } : null,
    savedCents: b.savings ? b.savings.solarCents + b.savings.batteryCents : null,
    openAlerts: openAlerts.map((a) => a.detail || a.title),
  };
};

/**
 * The daily summary, once per site and day, sent in the hour after 07:00 site time (so a worker
 * restart around 07:00 still sends it).
 */
export const dailySummaries = async (mailer: Mailer, appUrl: string, now = new Date()): Promise<number> => {
  let sent = 0;
  for (const site of await Site.find().lean<SiteDoc[]>()) {
    const clock = siteClock(now, site.tz);
    if (clock < DAILY_SUMMARY_AT || clock >= '08:00') continue;
    const people = (await recipients(String(site._id), now)).filter((r) => r.prefs.daily);
    if (!people.length) continue;
    const yesterday = previousDate(siteDate(now, site.tz));
    const pending = [];
    for (const r of people) if (!(await Email.exists({ key: `daily:${site._id}:${yesterday}:${r.userId}` }))) pending.push(r);
    if (!pending.length) continue;
    const summary = await summarizeDay(site, yesterday, now);
    for (const r of pending) {
      const key = `daily:${site._id}:${yesterday}:${r.userId}`;
      if (await sendOnce(mailer, { key, siteId: String(site._id), userId: r.userId, kind: 'daily' }, dailyEmail(site, summary, r, appUrl), now)) sent++;
    }
  }
  return sent;
};

/**
 * New proposals to the people who can approve them (Settings → Rules → Approval: "Email new
 * proposals to" approvers, the owner only, or nobody), if they have "New proposals" on. Quiet
 * hours apply; a proposal that expires before they end isn't sent.
 */
export const notifyProposals = async (mailer: Mailer, appUrl: string, now = new Date()): Promise<number> => {
  let sent = 0;
  const open = await Recommendation.find({ status: 'proposed', expiresAt: { $gt: now }, proposedAt: { $gte: new Date(now.getTime() - ALERT_EMAIL_WINDOW_MS) } }).lean<RecommendationDoc[]>();
  const bySite = new Map<string, RecommendationDoc[]>();
  for (const r of open) bySite.set(String(r.siteId), [...(bySite.get(String(r.siteId)) ?? []), r]);
  for (const [siteId, list] of bySite) {
    const site = await Site.findById(siteId).lean<SiteDoc>();
    if (!site) continue;
    const saved = await RuleConfig.findOne({ siteId, ruleId: 'approval' }).lean<RuleConfigDoc>();
    const approval: ApprovalConfig = { ...APPROVAL_DEFAULTS, ...((saved?.params as Partial<ApprovalConfig>) ?? {}) };
    if (approval.email === 'nobody') continue;
    const roles = approval.email === 'owner' || approval.who === 'owner' ? ['owner'] : ['owner', 'manager'];
    const people = (await recipients(siteId, now)).filter((r) => roles.includes(r.role) && r.prefs.recs);
    for (const rec of list)
      for (const r of people) {
        if (inQuietHours(now, site.tz, r.prefs.quietFrom, r.prefs.quietTo)) continue;
        const key = `proposal:${rec._id}:${r.userId}`;
        if (await sendOnce(mailer, { key, siteId, userId: r.userId, kind: 'proposal' }, proposalEmail(site, rec, r, appUrl), now)) sent++;
      }
  }
  return sent;
};
