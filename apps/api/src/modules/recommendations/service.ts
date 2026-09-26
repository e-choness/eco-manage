import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { Command, Device, Recommendation, RuleConfig, recordAudit, type DeviceDoc, type RecommendationDoc, type RuleConfigDoc, type SiteDoc } from '@ecomanage/db';
import { MANUAL_RULE_ID, RULES, recheck } from '@ecomanage/recs';
import {
  APPROVAL_DEFAULTS,
  OPEN_RECOMMENDATION_STATUSES,
  RECOMMENDATION_RULES,
  dedupeKeyOf,
  siteEventsChannel,
  type ApprovalConfig,
  type ManualRecommendationBody,
  type RecommendationDetail,
  type RecommendationView,
  type Role,
  type SiteEvent,
} from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';

// Recommendations API (plan P3-03, Backend Coverage §2): decisions proposed by the rules service or
// asked for on the Devices page. Checks run again at approval against the site as it is then; any
// failing check blocks the approval (409). Approving creates the Command (sent by P3-04).

const PAGE_MAX = 200;
const COMMAND_GRACE_MS = 15 * 60_000; // a command must reach the gateway this soon after its start
const MANUAL_DECIDE_MS = 15 * 60_000;

const fail = (status: number, message: string, details?: unknown) =>
  new HttpError(status, { error: { code: status, message, ...(details ? { details } : {}) } });

export interface RecDeps {
  redis?: Redis;
}

const publish = async (redis: Redis | undefined, siteId: string, event: SiteEvent) => {
  if (redis) await redis.publish(siteEventsChannel(siteId), JSON.stringify(event)).catch(() => undefined);
};

const ruleTitle = (ruleId: string) =>
  ruleId === MANUAL_RULE_ID ? 'Manual request' : (RECOMMENDATION_RULES[ruleId as keyof typeof RECOMMENDATION_RULES]?.title ?? ruleId);

const deviceNames = async (site: SiteDoc, ids: string[]) => {
  const valid = [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id));
  const devices = await Device.find({ siteId: site._id, _id: { $in: valid } }).select('name').lean<DeviceDoc[]>();
  return new Map(devices.map((d) => [String(d._id), d.name]));
};

const view = (r: RecommendationDoc, names: Map<string, string>): RecommendationView => ({
  id: String(r._id),
  ruleId: r.ruleId,
  ruleTitle: ruleTitle(r.ruleId),
  deviceId: r.deviceId,
  deviceName: names.get(r.deviceId) ?? null,
  action: r.action,
  params: (r.params as Record<string, unknown>) ?? {},
  title: r.title,
  window: { start: r.window.start!.toISOString(), end: r.window.end!.toISOString() },
  expectedSavingCents: r.expectedSavingCents ?? 0,
  status: r.status as RecommendationView['status'],
  proposedAt: r.proposedAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
});

export const approvalOf = async (site: SiteDoc): Promise<ApprovalConfig> => {
  const saved = await RuleConfig.findOne({ siteId: site._id, ruleId: 'approval' }).lean<RuleConfigDoc>();
  return { ...APPROVAL_DEFAULTS, ...((saved?.params as Partial<ApprovalConfig>) ?? {}) };
};

/** Installers never approve; managers only when Settings → Rules says "Owner or manager". */
const mayApprove = (approval: ApprovalConfig, role: Role) => role === 'owner' || (role === 'manager' && approval.who === 'owner-or-manager');

const OPEN = OPEN_RECOMMENDATION_STATUSES;

export const listRecommendations = async (site: SiteDoc, q: { state: 'open' | 'closed'; limit: number; before?: Date }) => {
  const status = q.state === 'open' ? { $in: OPEN } : { $nin: OPEN };
  const docs = await Recommendation.find({ siteId: site._id, status, ...(q.before ? { proposedAt: { $lt: q.before } } : {}) })
    .sort({ proposedAt: -1, _id: -1 })
    .limit(Math.min(q.limit, PAGE_MAX))
    .lean<RecommendationDoc[]>();
  const [names, open, closed] = await Promise.all([
    deviceNames(site, docs.map((d) => d.deviceId)),
    Recommendation.countDocuments({ siteId: site._id, status: { $in: OPEN } }),
    Recommendation.countDocuments({ siteId: site._id, status: { $nin: OPEN } }),
  ]);
  return { items: docs.map((d) => view(d, names)), counts: { open, closed } };
};

const findRec = async (site: SiteDoc, id: string): Promise<RecommendationDoc> => {
  const rec = mongoose.isValidObjectId(id) ? await Recommendation.findOne({ _id: id, siteId: site._id }).lean<RecommendationDoc>() : null;
  if (!rec) throw fail(404, 'Recommendation not found');
  return rec;
};

const commandTimes = (window: { start: Date; end: Date }, now: Date) => ({
  expiresAt: new Date(Math.max(window.start.getTime(), now.getTime()) + COMMAND_GRACE_MS),
  revertAt: window.end,
});

const person = async (id: unknown) => {
  if (!id) return null;
  const u = await User.findById(id).select('name email').lean();
  return u ? { id: String(u._id), name: u.name || u.email } : null;
};

export const recommendationDetail = async (site: SiteDoc, role: Role, id: string, now = new Date()): Promise<RecommendationDetail> => {
  const rec = await findRec(site, id);
  const [names, approval, decidedBy] = await Promise.all([deviceNames(site, [rec.deviceId]), approvalOf(site), person(rec.decidedBy)]);
  const t = commandTimes({ start: rec.window.start!, end: rec.window.end! }, now);
  return {
    ...view(rec, names),
    inputs: (rec.inputs ?? []).map((i) => ({ label: i.label!, value: i.value! })),
    checks: (rec.checks ?? []).map((c) => ({ text: c.text!, pass: !!c.pass })),
    calc: rec.calc ?? '',
    decidedBy,
    decidedAt: rec.decidedAt?.toISOString() ?? null,
    declineReason: rec.declineReason ?? null,
    commandId: rec.commandId ? String(rec.commandId) : null,
    payload: { deviceId: rec.deviceId, action: rec.action, params: (rec.params as Record<string, unknown>) ?? {}, expiresAt: t.expiresAt.toISOString(), revertAt: t.revertAt.toISOString() },
    canApprove: rec.status === 'proposed' && rec.expiresAt > now && mayApprove(approval, role),
  };
};

/** A person's request from the Devices page: the same checks as a rule's proposal. */
export const createManual = async (deps: RecDeps, site: SiteDoc, userId: string, body: ManualRecommendationBody, now = new Date()) => {
  const device = mongoose.isValidObjectId(body.deviceId) ? await Device.findOne({ _id: body.deviceId, siteId: site._id }).lean<DeviceDoc>() : null;
  if (!device) throw fail(404, 'Device not found');
  if (!deps.redis) throw fail(503, 'Live data is unavailable (no Redis)');
  const siteId = String(site._id);
  const action = { deviceId: body.deviceId, action: body.action, params: body.params, window: body.window };
  const checked = (await recheck(siteId, MANUAL_RULE_ID, action, { redis: deps.redis, rules: RULES, now }))!;
  const dedupeKey = dedupeKeyOf(MANUAL_RULE_ID, body.deviceId, body.window);
  const requester = await person(userId);
  try {
    const [rec] = await Recommendation.create([
      {
        siteId: site._id,
        ruleId: MANUAL_RULE_ID,
        dedupeKey,
        deviceId: body.deviceId,
        action: body.action,
        params: body.params,
        title: `${body.action.replace(/_/g, ' ')} · ${device.name}`,
        window: body.window,
        inputs: [
          { label: 'Requested by', value: requester?.name ?? 'someone' },
          { label: 'Device', value: device.name },
        ],
        checks: checked.checks,
        calc: checked.calc,
        expectedSavingCents: 0,
        status: 'proposed',
        proposedAt: now,
        expiresAt: new Date(Math.max(body.window.start.getTime(), now.getTime() + MANUAL_DECIDE_MS)),
        createdBy: userId,
      },
    ]);
    await recordAudit({ siteId: site._id, userId, action: 'recommendation.request', target: `recommendation:${rec._id}`, after: action });
    await publish(deps.redis, siteId, { type: 'inbox', itemType: 'decide', itemId: String(rec._id) });
    return recommendationDetail(site, 'owner', String(rec._id), now);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw fail(409, 'The same request is already waiting for a decision');
    throw err;
  }
};

const adjusted = (rec: RecommendationDoc, params?: Record<string, unknown>) => ({
  deviceId: rec.deviceId,
  action: rec.action,
  params: { ...((rec.params as Record<string, unknown>) ?? {}), ...(params ?? {}) },
  window: { start: rec.window.start!, end: rec.window.end! },
});

/** The checks and saving for the action as adjusted in the Inbox. Writes nothing. */
export const checkRecommendation = async (deps: RecDeps, site: SiteDoc, id: string, params?: Record<string, unknown>, now = new Date()) => {
  const rec = await findRec(site, id);
  if (!deps.redis) throw fail(503, 'Live data is unavailable (no Redis)');
  const result = await recheck(String(site._id), rec.ruleId, adjusted(rec, params), { redis: deps.redis, rules: RULES, now });
  if (!result) throw fail(409, 'This recommendation can no longer be checked');
  return { ...result, allPass: result.checks.every((c) => c.pass) };
};

export const approve = async (deps: RecDeps, site: SiteDoc, userId: string, role: Role, id: string, params?: Record<string, unknown>, now = new Date()) => {
  const rec = await findRec(site, id);
  if (!mayApprove(await approvalOf(site), role)) throw fail(403, 'Only the owner can approve (Settings → Rules → Who can approve)');
  if (rec.status !== 'proposed') throw fail(409, `Already ${rec.status}`);
  if (rec.expiresAt <= now) throw fail(409, 'This proposal has expired');
  if (!deps.redis) throw fail(503, 'Live data is unavailable (no Redis)');

  // Checks run again now: the battery, demand or limits may have changed since the proposal.
  const action = adjusted(rec, params);
  const result = await recheck(String(site._id), rec.ruleId, action, { redis: deps.redis, rules: RULES, now });
  if (!result) throw fail(409, 'This recommendation can no longer be checked');
  const failing = result.checks.filter((c) => !c.pass);
  if (failing.length) throw fail(409, `A check fails now: ${failing.map((c) => c.text).join('; ')}`, { checks: result.checks });

  const times = commandTimes(action.window, now);
  const [command] = await Command.create([
    { siteId: site._id, deviceId: rec.deviceId, recommendationId: rec._id, action: rec.action, params: action.params, ...times, status: 'created', createdBy: userId },
  ]);
  const updated = await Recommendation.findOneAndUpdate(
    { _id: rec._id, status: 'proposed' },
    {
      $set: {
        status: 'approved',
        params: action.params,
        checks: result.checks,
        calc: result.calc,
        expectedSavingCents: result.expectedSavingCents,
        decidedBy: userId,
        decidedAt: now,
        commandId: command._id,
      },
    },
    { new: true }
  ).lean<RecommendationDoc>();
  if (!updated) {
    // Someone else decided first.
    await Command.deleteOne({ _id: command._id });
    throw fail(409, 'Someone else decided on it first');
  }
  await recordAudit({
    siteId: site._id,
    userId,
    action: 'recommendation.approve',
    target: `recommendation:${rec._id}`,
    before: { params: rec.params },
    after: { params: action.params, commandId: String(command._id) },
  });
  const siteId = String(site._id);
  await publish(deps.redis, siteId, { type: 'inbox', itemType: 'decide', itemId: String(rec._id) });
  await publish(deps.redis, siteId, { type: 'command', commandId: String(command._id), deviceId: rec.deviceId, status: 'created' });
  return { recommendation: await recommendationDetail(site, role, id, now), commandId: String(command._id) };
};

export const decline = async (deps: RecDeps, site: SiteDoc, userId: string, role: Role, id: string, reason: string, now = new Date()) => {
  const rec = await findRec(site, id);
  if (rec.status !== 'proposed') throw fail(409, `Already ${rec.status}`);
  const updated = await Recommendation.findOneAndUpdate(
    { _id: rec._id, status: 'proposed' },
    { $set: { status: 'declined', declineReason: reason, decidedBy: userId, decidedAt: now } },
    { new: true }
  ).lean<RecommendationDoc>();
  if (!updated) throw fail(409, 'Someone else decided on it first');
  await recordAudit({ siteId: site._id, userId, action: 'recommendation.decline', target: `recommendation:${rec._id}`, after: { reason } });
  await publish(deps.redis, String(site._id), { type: 'inbox', itemType: 'decide', itemId: String(rec._id) });
  return recommendationDetail(site, role, id, now);
};
