import mongoose, { type FilterQuery } from 'mongoose';
import { AuditEvent, type AuditEventDoc, type SiteDoc } from '@ecomanage/db';
import type { AuditEntry, AuditPage, AuditQuery } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';

// The audit log (P3-07): newest first, paged with a cursor on (ts, _id) so entries written while
// someone pages don't shift the pages.

const bad = (message: string) => new HttpError(400, { error: { code: 400, message } });

const encodeCursor = (e: AuditEventDoc) => Buffer.from(`${e.ts.toISOString()}|${e._id}`).toString('base64url');
const decodeCursor = (cursor: string) => {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!ts || Number.isNaN(Date.parse(ts)) || !mongoose.isValidObjectId(id)) throw bad('Invalid cursor');
  return { ts: new Date(ts), id: new mongoose.Types.ObjectId(id) };
};

export const listAudit = async (site: SiteDoc, q: AuditQuery): Promise<AuditPage> => {
  const and: FilterQuery<AuditEventDoc>[] = [{ siteId: site._id }];
  // "device" finds every device.* action; "device.update" finds that one (and any below it).
  if (q.action) and.push({ $or: [{ action: q.action }, { action: { $regex: `^${q.action.replace(/\./g, '\\.')}\\.` } }] });
  if (q.userId) and.push({ userId: new mongoose.Types.ObjectId(q.userId) });
  if (q.target) and.push({ target: q.target });
  if (q.from) and.push({ ts: { $gte: new Date(q.from) } });
  if (q.to) and.push({ ts: { $lt: new Date(q.to) } });
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    and.push({ $or: [{ ts: { $lt: c.ts } }, { ts: c.ts, _id: { $lt: c.id } }] });
  }
  const rows = await AuditEvent.find({ $and: and }).sort({ ts: -1, _id: -1 }).limit(q.limit + 1).lean<AuditEventDoc[]>();
  const page = rows.slice(0, q.limit);
  const ids = [...new Set(page.map((e) => e.userId).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  return {
    items: page.map(
      (e): AuditEntry => ({
        id: String(e._id),
        ts: e.ts.toISOString(),
        action: e.action,
        target: e.target,
        user: e.userId ? { id: String(e.userId), name: names.get(String(e.userId)) ?? 'Former user' } : null,
        before: e.before ?? null,
        after: e.after ?? null,
      })
    ),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]) : null,
  };
};
