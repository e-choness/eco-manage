import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { Alert, Command, Device, Maintenance, RuleMute, alertView, recordAudit, type AlertDoc, type CommandDoc, type DeviceDoc, type SiteDoc } from '@ecomanage/db';
import { getProfile } from '@ecomanage/profiles';
import {
  ALERT_SNOOZE_HOURS,
  FALSE_ALARM_MUTE_DAYS,
  alertActions,
  siteEventsChannel,
  type AlertDetail,
  type AlertView,
  type ResolveAlertBody,
  type SiteEvent,
} from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import type { GatewayLink } from '../../lib/gatewayLink';
import User from '../auth/model';

// Alerts API (plan P2-08, Backend Coverage §3). The rules service opens alerts and closes them
// when their condition clears; these endpoints record who is handling one, pause its emails,
// send a remote fix, or close it with a cause. None of them can hide a problem that is still
// happening: only "False alarm" closes an alert whose condition is true, and it mutes the check
// for that device for 7 days and flags it for review.

const HOUR_MS = 3600_000;
const FIX_EXPIRES_MS = 2 * 60_000;
const PAGE_MAX = 200;

const fail = (status: number, message: string, details?: unknown) =>
  new HttpError(status, { error: { code: status, message, ...(details ? { details } : {}) } });

export interface AlertDeps {
  redis?: Redis;
  gateway?: GatewayLink;
}

const publish = async (redis: Redis | undefined, siteId: string, event: SiteEvent) => {
  if (redis) await redis.publish(siteEventsChannel(siteId), JSON.stringify(event)).catch(() => undefined);
};

const findAlert = async (site: SiteDoc, id: string): Promise<AlertDoc> => {
  const alert = mongoose.isValidObjectId(id) ? await Alert.findOne({ _id: id, siteId: site._id }).lean<AlertDoc>() : null;
  if (!alert) throw fail(404, 'Alert not found');
  return alert;
};

const deviceOf = (site: SiteDoc, deviceId: string | null) =>
  deviceId && mongoose.isValidObjectId(deviceId) ? Device.findOne({ _id: deviceId, siteId: site._id }).lean<DeviceDoc>() : Promise.resolve(null);

const fixesOf = (device: DeviceDoc | null) => (device?.profileId ? (getProfile(device.profileId)?.fixes ?? []) : []);

export const listAlerts = async (site: SiteDoc, q: { state: 'open' | 'closed'; limit: number; before?: Date }) => {
  const states = q.state === 'open' ? ['open', 'ack'] : ['resolved'];
  const filter = { siteId: site._id, state: { $in: states }, ...(q.before ? { openedAt: { $lt: q.before } } : {}) };
  const [docs, open, closed] = await Promise.all([
    Alert.find(filter).sort({ openedAt: -1, _id: -1 }).limit(Math.min(q.limit, PAGE_MAX)).lean<AlertDoc[]>(),
    Alert.countDocuments({ siteId: site._id, state: { $in: ['open', 'ack'] } }),
    Alert.countDocuments({ siteId: site._id, state: 'resolved' }),
  ]);
  return { items: docs.map(alertView), counts: { open, closed } };
};

const person = async (id: unknown) => {
  if (!id) return null;
  const u = await User.findById(id).select('name email').lean();
  return u ? { id: String(u._id), name: u.name || u.email } : null;
};

export const alertDetail = async (site: SiteDoc, id: string): Promise<AlertDetail> => {
  const alert = await findAlert(site, id);
  const device = await deviceOf(site, alert.deviceId ?? null);
  const fixes = fixesOf(device);
  const view = alertView(alert);
  return {
    ...view,
    deviceName: device?.name ?? null,
    ackBy: await person(alert.ackBy),
    ackAt: alert.ackAt?.toISOString() ?? null,
    snoozedUntil: alert.snoozedUntil?.toISOString() ?? null,
    resolution: alert.resolution
      ? { cause: alert.resolution.cause ?? '', note: alert.resolution.note ?? '', by: await person(alert.resolution.by), auto: !!alert.resolution.auto }
      : null,
    fixes: fixes.map((f) => ({ id: f.id, label: f.label })),
    actions: alertActions(view, fixes.length > 0),
  };
};

/** Applies a guarded update; a lost race (the rules service closed it meanwhile) is a 409. */
const update = async (alert: AlertDoc, guard: object, set: object, conflict: string): Promise<AlertDoc> => {
  const updated = await Alert.findOneAndUpdate({ _id: alert._id, ...guard }, { $set: set }, { new: true }).lean<AlertDoc>();
  if (!updated) throw fail(409, conflict);
  return updated;
};

const done = async (deps: AlertDeps, site: SiteDoc, alert: AlertDoc): Promise<AlertView> => {
  const view = alertView(alert);
  await publish(deps.redis, String(site._id), { type: 'alert', alert: view });
  return view;
};

/** Acknowledge: records who is handling it; stops the escalation email. Stays open. */
export const ack = async (deps: AlertDeps, site: SiteDoc, userId: string, id: string, now = new Date()) => {
  const alert = await findAlert(site, id);
  if (!alertActions(alertView(alert), false).ack) throw fail(409, alert.state === 'ack' ? 'Already acknowledged' : 'The alert is closed');
  const updated = await update(alert, { state: 'open' }, { state: 'ack', ackBy: userId, ackAt: now }, 'The alert changed; reload it');
  await recordAudit({ siteId: site._id, userId, action: 'alert.ack', target: `alert:${id}`, before: { state: alert.state }, after: { state: 'ack' } });
  return done(deps, site, updated);
};

/** Pause emails for 24 h while the condition is still true. It stays in the Inbox. */
export const snooze = async (deps: AlertDeps, site: SiteDoc, userId: string, id: string, now = new Date()) => {
  const alert = await findAlert(site, id);
  if (!alertActions(alertView(alert), false).snooze) throw fail(409, 'Emails can only be paused while the condition is still true');
  const until = new Date(now.getTime() + ALERT_SNOOZE_HOURS * HOUR_MS);
  const updated = await update(alert, { state: { $in: ['open', 'ack'] }, condition: 'active' }, { snoozedUntil: until }, 'The alert changed; reload it');
  await recordAudit({ siteId: site._id, userId, action: 'alert.snooze', target: `alert:${id}`, after: { snoozedUntil: until } });
  return done(deps, site, updated);
};

/**
 * Close with a cause and note (saved to the device's maintenance log). Only once the condition has
 * cleared, unless the cause is "False alarm": that closes it anyway, mutes the check for this
 * device for 7 days and flags its threshold for review.
 */
export const resolve = async (deps: AlertDeps, site: SiteDoc, userId: string, id: string, body: ResolveAlertBody, now = new Date()) => {
  const alert = await findAlert(site, id);
  if (alert.state === 'resolved') throw fail(409, 'The alert is already closed');
  const falseAlarm = body.cause === 'False alarm';
  if (!falseAlarm && alert.condition === 'active')
    throw fail(409, 'The condition is still true. The alert closes by itself when it clears, or close it as a false alarm.', { condition: 'active' });
  const resolution = { cause: body.cause, note: body.note, by: userId, auto: false };
  const guard = { state: { $in: ['open', 'ack'] }, ...(falseAlarm ? {} : { condition: 'cleared' }) };
  const updated = await update(alert, guard, { state: 'resolved', resolvedAt: now, resolution }, 'The alert changed; reload it');

  let mute: { until: string } | null = null;
  if (falseAlarm) {
    const until = new Date(now.getTime() + FALSE_ALARM_MUTE_DAYS * 24 * HOUR_MS);
    await RuleMute.create({ siteId: site._id, deviceId: alert.deviceId ?? null, ruleId: alert.ruleId, until, by: userId, alertId: alert._id, review: true });
    mute = { until: until.toISOString() };
  }
  if (alert.deviceId)
    await Maintenance.create({
      siteId: site._id,
      deviceId: alert.deviceId,
      at: now,
      by: userId,
      source: 'alert',
      alertId: alert._id,
      text: `${alert.title}: ${body.cause}${body.note ? `. ${body.note}` : ''}`,
    });
  await recordAudit({
    siteId: site._id,
    userId,
    action: falseAlarm ? 'alert.false-alarm' : 'alert.resolve',
    target: `alert:${id}`,
    before: { state: alert.state, condition: alert.condition },
    after: { state: 'resolved', cause: body.cause, note: body.note, ...(mute ? { muteUntil: mute.until } : {}) },
  });
  return { alert: await done(deps, site, updated), mute };
};

const commandView = (c: CommandDoc) => ({
  id: String(c._id),
  deviceId: c.deviceId,
  action: c.action,
  params: c.params ?? {},
  status: c.status,
  expiresAt: c.expiresAt.toISOString(),
  sentAt: c.sentAt?.toISOString() ?? null,
  error: c.error ?? null,
});

/**
 * Remote fix: a Command made from a fix listed in the device's profile, sent to the gateway.
 * If the device recovers, the rules service closes the alert.
 */
export const fix = async (deps: AlertDeps, site: SiteDoc, userId: string, id: string, fixId: string, now = new Date()) => {
  const alert = await findAlert(site, id);
  const device = await deviceOf(site, alert.deviceId ?? null);
  const fixes = fixesOf(device);
  if (!alertActions(alertView(alert), fixes.length > 0).fix) throw fail(409, 'A remote fix is only offered while the condition is true and the device profile has one');
  const f = fixes.find((x) => x.id === fixId);
  if (!f) throw fail(422, `Unknown fix ${fixId}`, { fixes: fixes.map((x) => x.id) });

  const expiresAt = new Date(now.getTime() + FIX_EXPIRES_MS);
  const command = await Command.create({ siteId: site._id, deviceId: String(device!._id), alertId: alert._id, action: f.action, params: f.params ?? {}, expiresAt, revertAt: null, createdBy: userId });
  const sent = deps.gateway
    ? await deps.gateway.sendCommand(String(site._id), String(command._id), { deviceId: String(device!._id), action: f.action, params: f.params ?? {}, expiresAt: expiresAt.toISOString(), revertAt: null })
    : false;
  const saved = (await Command.findByIdAndUpdate(
    command._id,
    { $set: sent ? { status: 'sent', sentAt: now } : { status: 'failed', failedAt: now, error: 'Could not reach the gateway' } },
    { new: true }
  ).lean<CommandDoc>())!;
  await recordAudit({ siteId: site._id, userId, action: 'alert.fix', target: `alert:${id}`, after: { fixId, commandId: String(command._id), status: saved.status } });
  await publish(deps.redis, String(site._id), { type: 'command', commandId: String(saved._id), deviceId: saved.deviceId, status: saved.status });
  if (!sent) throw fail(503, 'Could not reach the gateway. Try again in a minute.', { command: commandView(saved) });
  return { command: commandView(saved) };
};
