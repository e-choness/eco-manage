/**
 * P3-07: the audit log. Owners read it; every write endpoint records to it, and every one of those
 * records is checked by a test (the inventory below fails when a new write endpoint isn't listed).
 */
import { readdirSync, readFileSync } from 'node:fs';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Membership, Site } from '@ecomanage/db';
import type { AuditEntry } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { listRoutes } from './routes';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

// Every route that writes, and the audit action(s) it records, or why it records none.
const WRITES: Record<string, string[] | string> = {
  'post /api/auth/login': 'signing in changes no site data',
  'post /api/auth/register': 'creates an account; it has no site until invited',
  'post /api/auth/logout': 'signing out changes no site data',
  'post /api/auth/refresh': 'renews a session; no site data',
  'put /api/auth/password': "the person's own account, not a site",
  'put /api/auth/profile': "the person's own account, not a site",
  'post /api/alerts/:id/ack': ['alert.ack'],
  'post /api/alerts/:id/snooze': ['alert.snooze'],
  'post /api/alerts/:id/resolve': ['alert.resolve', 'alert.false-alarm'],
  'post /api/alerts/:id/fix': ['alert.fix'],
  'post /api/devices/': ['device.create'],
  'patch /api/devices/:id': ['device.update'],
  'delete /api/devices/:id': ['device.delete'],
  'post /api/recommendations/': ['recommendation.request'],
  'post /api/recommendations/:id/check': 'reruns the checks and returns them; writes nothing',
  'post /api/recommendations/:id/approve': ['recommendation.approve'],
  'post /api/recommendations/:id/decline': ['recommendation.decline'],
  'post /api/commands/:id/cancel': ['command.cancel'],
  'patch /api/site/': ['site.update'],
  'put /api/site/pv-arrays': ['site.pv-arrays'],
  'patch /api/site/battery': ['site.battery'],
  'post /api/tariffs/': ['tariff.create'],
  'post /api/bills/:period/utility-bill': ['bill.utility.upload', 'bill.utility.enter'],
  'put /api/calendar/': ['calendar.update'],
  'patch /api/me/notifications': ['notifications.update'],
};

const siteId = new mongoose.Types.ObjectId();
const otherSite = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const users: Record<string, mongoose.Types.ObjectId> = {};
let app: ReturnType<typeof createApp>;
const T = (min: number) => new Date(Date.parse('2026-09-24T16:00:00Z') + min * 60_000);

beforeAll(async () => {
  await connectTestDb('audit');
  process.env.JWT_SECRET = 'audit-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create([
    { _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' },
    { _id: otherSite, name: 'Elsewhere' },
  ]);
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['owner', 'Priya Shah'], ['manager', 'Jamie Reyes'], ['installer', 'Northside Solar']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'audit-jwt');
    users[role] = u._id as mongoose.Types.ObjectId;
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await AuditEvent.deleteMany({});
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const event = (min: number, action: string, userId: mongoose.Types.ObjectId | null, over: object = {}) =>
  AuditEvent.create({ siteId, userId, action, target: `${action.split('.')[0]}:1`, ts: T(min), ...over });

describe('write endpoints', () => {
  it('are all listed, with their audit action or why they have none', () => {
    const writes = listRoutes(app).filter((r) => !r.startsWith('get '));
    expect(writes.sort()).toEqual(Object.keys(WRITES).sort());
  });

  it('each have a test that checks their audit record', () => {
    const dir = __dirname;
    const tests = readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts') && f !== 'audit.test.ts')
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .join('\n');
    const actions = Object.values(WRITES).filter((a): a is string[] => Array.isArray(a)).flat();
    const untested = actions.filter((a) => !new RegExp(`AuditEvent\\.\\w+\\(\\{ action: '${a.replace(/\./g, '\\.')}'`).test(tests));
    expect(untested).toEqual([]);
  });
});

describe('GET /api/audit', () => {
  it('shows a change as it happens: who, what, before and after', async () => {
    expect((await as('owner', request(app).patch('/api/site')).send({ name: 'Maple Grove Public School' })).status).toBe(200);
    const res = await as('owner', request(app).get('/api/audit'));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      action: 'site.update',
      target: `site:${siteId}`,
      user: { id: String(users.owner), name: 'Priya Shah' },
      before: { name: 'Maple Grove School' },
      after: { name: 'Maple Grove Public School' },
    });
    expect(res.body.nextCursor).toBeNull();
    await Site.updateOne({ _id: siteId }, { $set: { name: 'Maple Grove School' } });
  });

  it('is for the owner only', async () => {
    expect((await as('manager', request(app).get('/api/audit'))).status).toBe(403);
    expect((await as('installer', request(app).get('/api/audit'))).status).toBe(403);
  });

  it('filters by action or group, person, target and time, and names system and former users', async () => {
    await event(1, 'device.create', users.installer, { target: 'device:ev4' });
    await event(2, 'device.update', users.installer, { target: 'device:ev4' });
    await event(3, 'alert.ack', users.manager);
    await event(4, 'alert.auto-resolve', null);
    await event(5, 'tariff.create', new mongoose.Types.ObjectId());
    await event(6, 'device.update', users.owner, { siteId: otherSite });
    const get = async (q: string) => (await as('owner', request(app).get(`/api/audit${q}`))).body.items.map((e: AuditEntry) => e.action);

    expect(await get('')).toEqual(['tariff.create', 'alert.auto-resolve', 'alert.ack', 'device.update', 'device.create']);
    expect(await get('?action=device')).toEqual(['device.update', 'device.create']);
    expect(await get('?action=device.update')).toEqual(['device.update']);
    expect(await get('?action=dev')).toEqual([]);
    expect(await get(`?userId=${users.manager}`)).toEqual(['alert.ack']);
    expect(await get('?target=device:ev4')).toEqual(['device.update', 'device.create']);
    expect(await get(`?from=${T(2).toISOString()}&to=${T(4).toISOString()}`)).toEqual(['alert.ack', 'device.update']);

    const all = (await as('owner', request(app).get('/api/audit'))).body.items as AuditEntry[];
    expect(all[0].user).toMatchObject({ name: 'Former user' });
    expect(all[1].user).toBeNull();
    expect(all[2].user).toEqual({ id: String(users.manager), name: 'Jamie Reyes' });
  });

  it('pages without repeats or gaps while new entries arrive', async () => {
    for (let m = 0; m < 20; m++) await event(m, 'alert.ack', users.manager);
    for (let i = 0; i < 5; i++) await event(10, 'alert.snooze', users.manager); // five at the same moment
    const everything = (await as('owner', request(app).get('/api/audit?limit=200'))).body.items.map((e: AuditEntry) => e.id);
    expect(everything).toHaveLength(25);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${cursor}` : '';
      const page = (await as('owner', request(app).get(`/api/audit?limit=7${q}`))).body;
      seen.push(...page.items.map((e: AuditEntry) => e.id));
      cursor = page.nextCursor;
      await event(100 + seen.length, 'device.update', users.installer); // newer than anything paged
    } while (cursor);
    expect(seen).toEqual(everything);
  });

  it('refuses a bad cursor or filter', async () => {
    expect((await as('owner', request(app).get('/api/audit?cursor=nonsense'))).status).toBe(400);
    expect((await as('owner', request(app).get('/api/audit?userId=me'))).status).toBe(400);
    expect((await as('owner', request(app).get('/api/audit?action[$ne]=x'))).status).toBe(400);
  });
});
