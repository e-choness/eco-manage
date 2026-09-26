import mongoose, { type FilterQuery } from 'mongoose';
import { Alert, Command, Device, Recommendation, type AlertDoc, type CommandDoc, type DeviceDoc, type RecommendationDoc, type SiteDoc } from '@ecomanage/db';
import {
  INBOX_TYPES,
  decodeInboxCursor,
  encodeInboxCursor,
  inboxOrder,
  type InboxCounts,
  type InboxItem,
  type InboxPage,
  type InboxQuery,
  type InboxType,
} from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';

// The Inbox (plan P3-06): decisions waiting for someone, alerts, and commands waiting or running,
// in one list. Each source knows its open and closed items; the list is merged newest first by
// arrival time (never changes) and paged with a cursor on (time, key), so paging stays stable
// while items move between open and closed.

type State = 'open' | 'closed';

// A command that doesn't revert (a remote fix) is done once verified; one that does, once reverted.
const COMMAND_OPEN = { revertOf: null, $or: [{ status: { $in: ['created', 'sent', 'acked'] } }, { status: 'verified', revertAt: { $ne: null }, revertedAt: null }] };
const COMMAND_CLOSED = { revertOf: null, $or: [{ status: { $in: ['failed', 'reverted', 'cancelled'] } }, { status: 'verified', $or: [{ revertAt: null }, { revertedAt: { $ne: null } }] }] };

const FILTERS: Record<InboxType, Record<State, object>> = {
  decide: { open: { status: 'proposed' }, closed: { status: { $in: ['declined', 'expired'] } } },
  alert: { open: { state: { $in: ['open', 'ack'] } }, closed: { state: 'resolved' } },
  active: { open: COMMAND_OPEN, closed: COMMAND_CLOSED },
};

// The field each source is ordered by: when the item arrived.
const AT = { decide: 'proposedAt', alert: 'openedAt', active: 'createdAt' } as const;

const fmt = (tz: string) => {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  return (d: Date) => time.format(d);
};
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const modelOf = (type: InboxType) => (type === 'decide' ? Recommendation : type === 'alert' ? Alert : Command) as unknown as mongoose.Model<unknown>;

export const inboxCounts = async (site: SiteDoc): Promise<InboxCounts> => {
  const count = (type: InboxType, state: State) => modelOf(type).countDocuments({ siteId: site._id, ...FILTERS[type][state] });
  const [od, oa, ox, cd, ca, cx] = await Promise.all([
    count('decide', 'open'),
    count('alert', 'open'),
    count('active', 'open'),
    count('decide', 'closed'),
    count('alert', 'closed'),
    count('active', 'closed'),
  ]);
  return {
    open: { decide: od, alert: oa, active: ox, all: od + oa + ox },
    closed: { decide: cd, alert: ca, active: cx, all: cd + ca + cx },
  };
};

/** Items of one source up to the cursor time, newest first. */
const fetchSource = (site: SiteDoc, type: InboxType, state: State, before: Date | null, limit: number) => {
  const at = AT[type];
  const filter: FilterQuery<unknown> = { siteId: site._id, ...FILTERS[type][state], ...(before ? { [at]: { $lte: before } } : {}) };
  // Items sharing the cursor's exact time are sorted out after merging, hence the spare rows.
  return modelOf(type)
    .find(filter)
    .sort({ [at]: -1, _id: -1 })
    .limit(limit + 20)
    .lean<Record<string, unknown>[]>();
};

const names = async (site: SiteDoc, deviceIds: (string | null | undefined)[]) => {
  const ids = [...new Set(deviceIds.filter((d): d is string => !!d && mongoose.isValidObjectId(d)))];
  const devices = await Device.find({ siteId: site._id, _id: { $in: ids } }).select('name').lean<DeviceDoc[]>();
  return new Map(devices.map((d) => [String(d._id), d.name]));
};

const people = async (ids: unknown[]) => {
  const valid = [...new Set(ids.filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: valid } }).select('name email').lean();
  return new Map(users.map((u) => [String(u._id), u.name || u.email]));
};

export const listInbox = async (site: SiteDoc, q: InboxQuery): Promise<InboxPage> => {
  const cursor = q.cursor ? decodeInboxCursor(q.cursor) : null;
  if (q.cursor && !cursor) throw new HttpError(400, { error: { code: 400, message: 'Invalid cursor' } });
  const types = q.type === 'all' ? [...INBOX_TYPES] : [q.type];
  const before = cursor ? new Date(cursor.at) : null;
  const [recs, alerts, commands] = await Promise.all([
    types.includes('decide') ? (fetchSource(site, 'decide', q.state, before, q.limit) as unknown as Promise<RecommendationDoc[]>) : Promise.resolve([]),
    types.includes('alert') ? (fetchSource(site, 'alert', q.state, before, q.limit) as unknown as Promise<AlertDoc[]>) : Promise.resolve([]),
    types.includes('active') ? (fetchSource(site, 'active', q.state, before, q.limit) as unknown as Promise<(CommandDoc & { createdAt: Date })[]>) : Promise.resolve([]),
  ]);
  const commandRecs = await Recommendation.find({ _id: { $in: commands.map((c) => c.recommendationId).filter(Boolean) } }).lean<RecommendationDoc[]>();
  const recOf = new Map(commandRecs.map((r) => [String(r._id), r]));
  const [deviceNames, who] = await Promise.all([
    names(site, [...recs.map((r) => r.deviceId), ...alerts.map((a) => a.deviceId), ...commands.map((c) => c.deviceId)]),
    people([...alerts.map((a) => a.ackBy), ...recs.map((r) => r.decidedBy), ...commandRecs.map((r) => r.decidedBy), ...commands.map((c) => c.createdBy)]),
  ]);
  const hhmm = fmt(site.tz);
  const device = (id: string | null | undefined) => (id ? (deviceNames.get(id) ?? null) : null);
  const withDevice = (id: string | null | undefined, text: string) => (device(id) ? `${device(id)} · ${text}` : text);

  const items: InboxItem[] = [
    ...recs.map((r): InboxItem => ({
      key: `decide:${r._id}`,
      type: 'decide',
      id: String(r._id),
      kind: r.status === 'proposed' ? 'Decision' : 'Closed',
      title: r.title,
      deviceId: r.deviceId,
      deviceName: device(r.deviceId),
      sub:
        r.status === 'proposed'
          ? withDevice(r.deviceId, `expected saving ${money(r.expectedSavingCents ?? 0)}`)
          : `${r.status === 'declined' ? 'Declined' : 'Expired'}${r.declineReason ? ` · ${r.declineReason}` : ''}${r.decidedBy ? ` · ${who.get(String(r.decidedBy)) ?? ''}` : ''}`,
      status: r.status,
      at: r.proposedAt.toISOString(),
      due: r.status === 'proposed' ? r.expiresAt.toISOString() : null,
    })),
    ...alerts.map((a): InboxItem => {
      const state = a.state === 'open' ? 'open' : a.state === 'ack' ? `acknowledged by ${who.get(String(a.ackBy)) ?? 'someone'}` : 'resolved';
      const snoozed = a.snoozedUntil && a.snoozedUntil > new Date() ? ' · emails paused' : '';
      return {
        key: `alert:${a._id}`,
        type: 'alert',
        id: String(a._id),
        kind: a.state === 'resolved' ? 'Closed' : a.severity === 'info' ? 'Info' : 'Alert',
        title: a.title,
        deviceId: a.deviceId ?? null,
        deviceName: device(a.deviceId),
        sub: withDevice(a.deviceId, `${state}${snoozed}`),
        status: a.state,
        at: a.openedAt.toISOString(),
        due: null,
      };
    }),
    ...commands.map((c): InboxItem => {
      const rec = c.recommendationId ? recOf.get(String(c.recommendationId)) : undefined;
      const approver = who.get(String(rec?.decidedBy ?? c.createdBy));
      const open = ['created', 'sent', 'acked', 'verified'].includes(c.status) && !(c.status === 'verified' && (!c.revertAt || c.revertedAt));
      const text: Record<string, string> = {
        created: `starts at ${c.sendAt ? hhmm(c.sendAt) : 'once sent'}`,
        sent: 'sending…',
        acked: 'confirmed by the gateway, checking',
        verified: c.revertAt && !c.revertedAt ? `running until ${hhmm(c.revertAt)}` : 'done',
        reverted: `done${rec?.actualSavingCents != null ? ` · saved ${money(rec.actualSavingCents)}` : ''}`,
        failed: `failed${c.error ? `: ${c.error}` : ''}`,
        cancelled: 'cancelled',
      };
      return {
        key: `active:${c._id}`,
        type: 'active',
        id: String(c._id),
        kind: open ? 'Active' : 'Closed',
        title: rec?.title ?? `${c.action.replace(/_/g, ' ')}`,
        deviceId: c.deviceId,
        deviceName: device(c.deviceId),
        sub: withDevice(c.deviceId, `${text[c.status] ?? c.status}${approver ? ` · approved by ${approver}` : ''}`),
        status: c.status,
        at: c.createdAt.toISOString(),
        due: c.revertAt?.toISOString() ?? null,
      };
    }),
  ];

  const after = cursor ? items.filter((i) => inboxOrder(i, cursor) > 0) : items;
  const sorted = after.sort(inboxOrder);
  const page = sorted.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page,
    counts: await inboxCounts(site),
    nextCursor: sorted.length > q.limit && last ? encodeInboxCursor(last.at, last.key) : null,
  };
};
