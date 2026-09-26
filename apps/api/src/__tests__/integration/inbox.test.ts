/**
 * P3-06: the Inbox. Decisions, alerts and commands in one list with counts, and paging that stays
 * stable while items change state.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Alert, Command, Device, Membership, Recommendation, Site } from '@ecomanage/db';
import type { InboxItem } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const bat = new mongoose.Types.ObjectId();
const ev3 = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const users: Record<string, mongoose.Types.ObjectId> = {};
let app: ReturnType<typeof createApp>;
const T = (min: number) => new Date(Date.parse('2026-09-24T16:00:00Z') + min * 60_000);

beforeAll(async () => {
  await connectTestDb('inbox');
  process.env.JWT_SECRET = 'inbox-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  await Device.create([
    { _id: bat, siteId, type: 'battery', name: 'Battery', status: 'live' },
    { _id: ev3, siteId, type: 'ev', name: 'EV charger 3', status: 'live' },
  ]);
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['owner', 'Priya Shah'], ['manager', 'Jamie Reyes'], ['installer', 'Northside Solar']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'inbox-jwt');
    users[role] = u._id as mongoose.Types.ObjectId;
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([Alert.deleteMany({}), Recommendation.deleteMany({}), Command.deleteMany({})]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

const rec = (min: number, over: object = {}) =>
  Recommendation.create({
    siteId,
    ruleId: 'peak-shaving',
    dedupeKey: `k${Math.random()}`,
    deviceId: String(bat),
    action: 'force_discharge',
    title: 'Discharge battery at 30 kW, 14:00–17:00',
    window: { start: T(120), end: T(300) },
    expectedSavingCents: 26_600,
    status: 'proposed',
    proposedAt: T(min),
    expiresAt: T(105),
    ...over,
  });

const alert = (min: number, over: object = {}) =>
  Alert.create({ siteId, deviceId: String(new mongoose.Types.ObjectId()), ruleId: 'device-silent', severity: 'warning', title: 'Device not reporting', detail: 'x', state: 'open', openedAt: T(min), lastSeenAt: T(min), ...over });

const command = async (min: number, status: string, over: object = {}) => {
  const r = await rec(min - 1, { status: 'approved', decidedBy: users.manager });
  const c = await Command.create({
    siteId,
    deviceId: String(bat),
    recommendationId: r._id,
    action: 'force_discharge',
    params: { kw: 30 },
    sendAt: T(120),
    expiresAt: T(135),
    revertAt: T(300),
    status,
    createdBy: users.manager,
    ...over,
  });
  await Command.collection.updateOne({ _id: c._id }, { $set: { createdAt: T(min) } }); // createdAt is immutable in mongoose
  return c;
};

describe('GET /api/inbox', () => {
  it('merges open decisions, alerts and commands, newest first, with counts', async () => {
    await rec(10);
    await alert(20, { deviceId: String(ev3) });
    await alert(25, { deviceId: String(ev3), ruleId: 'command-ack-slow', state: 'ack', ackBy: users.installer, severity: 'info', title: 'Command confirmed late' });
    await command(30, 'created');
    await command(40, 'verified');
    await rec(5, { status: 'declined', declineReason: 'Buses need a full charge', decidedBy: users.owner });
    await alert(1, { deviceId: String(ev3), state: 'resolved' });
    await command(2, 'reverted', { revertedAt: T(300) });
    await command(3, 'verified', { revertAt: null, action: 'reset' }); // a remote fix, done once verified

    const res = await as('installer', request(app).get('/api/inbox'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: InboxItem) => [i.type, i.kind, i.sub])).toEqual([
      ['active', 'Active', 'Battery · running until 17:00 · approved by Jamie Reyes'],
      ['active', 'Active', 'Battery · starts at 14:00 · approved by Jamie Reyes'],
      ['alert', 'Info', 'EV charger 3 · acknowledged by Northside Solar'],
      ['alert', 'Alert', 'EV charger 3 · open'],
      ['decide', 'Decision', 'Battery · expected saving $266'],
    ]);
    expect(res.body.items[4]).toMatchObject({ title: 'Discharge battery at 30 kW, 14:00–17:00', due: T(105).toISOString(), status: 'proposed' });
    expect(res.body.counts).toEqual({ open: { decide: 1, alert: 2, active: 2, all: 5 }, closed: { decide: 1, alert: 1, active: 2, all: 4 } });
    expect(res.body.nextCursor).toBeNull();

    const closed = await as('owner', request(app).get('/api/inbox?state=closed'));
    expect(closed.body.items.map((i: InboxItem) => [i.type, i.sub])).toEqual([
      ['decide', 'Declined · Buses need a full charge · Priya Shah'],
      ['active', 'Battery · done · approved by Jamie Reyes'],
      ['active', 'Battery · done · approved by Jamie Reyes'],
      ['alert', 'EV charger 3 · resolved'],
    ]);
  });

  it('filters by type, and refuses a bad cursor', async () => {
    await rec(10);
    await alert(20);
    const res = await as('manager', request(app).get('/api/inbox?type=alert'));
    expect(res.body.items.map((i: InboxItem) => i.type)).toEqual(['alert']);
    expect(res.body.counts.open.all).toBe(2);
    expect((await as('manager', request(app).get('/api/inbox?cursor=nonsense'))).status).toBe(400);
    expect((await as('manager', request(app).get('/api/inbox?type=everything'))).status).toBe(400);
  });

  it('pages without repeats or gaps while items move from open to closed', async () => {
    // 25 open alerts and decisions arriving a minute apart, two of them at the same moment
    for (let m = 0; m < 25; m++) await (m % 2 ? alert(m) : rec(m));
    await alert(12, { deviceId: String(bat) }); // same time as rec(12)
    const everything = (await as('owner', request(app).get('/api/inbox?limit=100'))).body.items.map((i: InboxItem) => i.key);
    expect(everything).toHaveLength(26);

    const seen: string[] = [];
    const first = (await as('owner', request(app).get('/api/inbox?limit=10'))).body;
    seen.push(...first.items.map((i: InboxItem) => i.key));
    // Meanwhile three items on page 1 and one further down are dealt with.
    const done = [first.items[0], first.items[3], first.items[9], { key: everything[15] }].map((i) => i.key as string);
    for (const key of done) {
      const [type, id] = key.split(':');
      if (type === 'alert') await Alert.updateOne({ _id: id }, { $set: { state: 'resolved' } });
      else await Recommendation.updateOne({ _id: id }, { $set: { status: 'declined' } });
    }
    let cursor = first.nextCursor;
    while (cursor) {
      const page = (await as('owner', request(app).get(`/api/inbox?limit=10&cursor=${cursor}`))).body;
      seen.push(...page.items.map((i: InboxItem) => i.key));
      cursor = page.nextCursor;
    }
    // Page 1 as it was, then everything after it that is still open, in the same order.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(everything.filter((k: string, i: number) => i < 10 || k !== everything[15]));
  });
});

describe('GET /api/inbox/counts', () => {
  it('answers the badge on its own', async () => {
    await alert(1);
    expect((await as('installer', request(app).get('/api/inbox/counts'))).body.open).toEqual({ decide: 0, alert: 1, active: 0, all: 1 });
  });
});
