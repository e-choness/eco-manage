import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { Command, Device, Recommendation, createRevertCommand, recordAudit, type CommandDoc, type DeviceDoc, type RecommendationDoc, type SiteDoc } from '@ecomanage/db';
import { siteEventsChannel, type CommandView, type SiteEvent } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';

// Commands (plan P3-04, Backend Coverage: GET /api/commands/:id, POST /:id/cancel). The rules
// service sends, verifies and reverts them; cancelling here only records the decision and, for a
// command already on its way, asks for the revert, which the rules service sends.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });
const ACTIVE: CommandDoc['status'][] = ['created', 'sent', 'acked', 'verified'];

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

const toView = (c: CommandDoc, names: Map<string, string>, recs: Map<string, RecommendationDoc>, reverts: Map<string, CommandDoc>): CommandView => {
  const rec = c.recommendationId ? recs.get(String(c.recommendationId)) : undefined;
  const rev = reverts.get(String(c._id));
  return {
    id: String(c._id),
    deviceId: c.deviceId,
    deviceName: names.get(c.deviceId) ?? null,
    action: c.action,
    params: (c.params as Record<string, unknown>) ?? {},
    status: c.status as CommandView['status'],
    sendAt: iso(c.sendAt),
    sentAt: iso(c.sentAt),
    ackedAt: iso(c.ackedAt),
    verifiedAt: iso(c.verifiedAt),
    failedAt: iso(c.failedAt),
    error: c.error ?? null,
    expiresAt: c.expiresAt.toISOString(),
    revertAt: iso(c.revertAt),
    revertedAt: iso(c.revertedAt),
    cancelledAt: iso(c.cancelledAt),
    recommendation: rec ? { id: String(rec._id), title: rec.title } : null,
    revert: rev ? { id: String(rev._id), action: rev.action, status: rev.status as CommandView['status'] } : null,
  };
};

const views = async (site: SiteDoc, docs: CommandDoc[]): Promise<CommandView[]> => {
  const deviceIds = [...new Set(docs.map((c) => c.deviceId))].filter((id) => mongoose.isValidObjectId(id));
  const [devices, recs, reverts] = await Promise.all([
    Device.find({ siteId: site._id, _id: { $in: deviceIds } }).select('name').lean<DeviceDoc[]>(),
    Recommendation.find({ _id: { $in: docs.map((c) => c.recommendationId).filter(Boolean) } }).select('title').lean<RecommendationDoc[]>(),
    Command.find({ revertOf: { $in: docs.map((c) => c._id) } }).lean<CommandDoc[]>(),
  ]);
  const names = new Map(devices.map((d) => [String(d._id), d.name]));
  const recMap = new Map(recs.map((r) => [String(r._id), r]));
  const revMap = new Map(reverts.map((r) => [String(r.revertOf), r]));
  return docs.map((c) => toView(c, names, recMap, revMap));
};

/** Commands waiting, on their way, or running now (the Inbox "Active" items). */
export const activeCommands = async (site: SiteDoc) => {
  const docs = await Command.find({ siteId: site._id, revertOf: null, status: { $in: ACTIVE } }).sort({ sendAt: 1, createdAt: 1 }).lean<CommandDoc[]>();
  return { items: await views(site, docs) };
};

const findCommand = async (site: SiteDoc, id: string) => {
  const c = mongoose.isValidObjectId(id) ? await Command.findOne({ _id: id, siteId: site._id }).lean<CommandDoc>() : null;
  if (!c) throw fail(404, 'Command not found');
  return c;
};

export const commandDetail = async (site: SiteDoc, id: string): Promise<CommandView> => (await views(site, [await findCommand(site, id)]))[0];

/**
 * Cancel early: a command not sent yet is simply dropped; one already sent or running gets its
 * revert (App v2 "Cancel early" sends a revert command).
 */
export const cancel = async (redis: Redis | undefined, site: SiteDoc, userId: string, id: string, now = new Date()): Promise<CommandView> => {
  const c = await findCommand(site, id);
  if (c.revertOf) throw fail(409, 'A revert cannot be cancelled');
  if (!ACTIVE.includes(c.status)) throw fail(409, `Already ${c.status}`);
  const updated = await Command.findOneAndUpdate(
    { _id: c._id, status: c.status },
    { $set: { status: 'cancelled', cancelledAt: now, cancelledBy: userId } },
    { new: true }
  ).lean<CommandDoc>();
  if (!updated) throw fail(409, 'The command changed; reload it');
  const wasOut = c.status !== 'created';
  if (wasOut) await createRevertCommand(updated, now);
  if (c.recommendationId) await Recommendation.updateOne({ _id: c.recommendationId }, { $set: { status: 'cancelled' } });
  await recordAudit({ siteId: site._id, userId, action: 'command.cancel', target: `command:${id}`, before: { status: c.status }, after: { status: 'cancelled', revert: wasOut } });
  if (redis) {
    const event: SiteEvent = { type: 'command', commandId: id, deviceId: c.deviceId, status: 'cancelled' };
    await redis.publish(siteEventsChannel(String(site._id)), JSON.stringify(event)).catch(() => undefined);
  }
  return commandDetail(site, id);
};
