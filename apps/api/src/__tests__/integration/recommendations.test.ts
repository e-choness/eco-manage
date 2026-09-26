/**
 * P3-03: Recommendations API. Checks run again at approval against the site as it is then; approval
 * follows Settings → Rules → Who can approve; installers never decide.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { AuditEvent, Command, Device, Membership, Recommendation, RuleConfig, Site, Tariff } from '@ecomanage/db';
import { TARIFF_TEMPLATES, dedupeKeyOf, siteEventsChannel } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/10') || 'redis://redis:6379/10';
const siteId = new mongoose.Types.ObjectId();
const sid = String(siteId);
const bat = new mongoose.Types.ObjectId();
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const HOUR = 3_600_000;

let redis: Redis;
let sub: Redis;
const events: { type: string; itemId?: string; commandId?: string; status?: string }[] = [];
let app: ReturnType<typeof createApp>;

const battery = (soc: number) => redis.set(`latest:${bat}`, JSON.stringify({ ts: new Date().toISOString(), p_kw: 0, soc_pct: soc, reserve_pct: 20, q: 'ok' }));

/** A peak-shaving proposal as the rules service makes it, starting in 2 h. */
const proposal = async (over: object = {}) => {
  const window = { start: new Date(Date.now() + 2 * HOUR), end: new Date(Date.now() + 3 * HOUR) };
  const doc = await Recommendation.create({
    siteId,
    ruleId: 'peak-shaving',
    dedupeKey: dedupeKeyOf('peak-shaving', String(bat), { start: window.start, end: new Date(window.end.getTime() + Math.random()) }),
    deviceId: String(bat),
    action: 'force_discharge',
    params: { kw: 25, until: window.end.toISOString() },
    title: 'Discharge battery at 25 kW',
    window,
    inputs: [{ label: 'Net peak forecast', value: '131 kW' }],
    checks: [{ text: 'Within the 60 kW discharge limit', pass: true }],
    calc: 'new peak 131 kW − current month peak 112 kW = 19 kW × $14/kW = $266',
    expectedSavingCents: 26_600,
    status: 'proposed',
    proposedAt: new Date(),
    expiresAt: new Date(window.start.getTime() - 15 * 60_000),
    ...over,
  });
  return String(doc._id);
};

beforeAll(async () => {
  await connectTestDb('recommendations');
  redis = new Redis(REDIS);
  await redis.flushdb();
  sub = redis.duplicate();
  await sub.subscribe(siteEventsChannel(sid));
  sub.on('message', (_c, m) => events.push(JSON.parse(m)));
  process.env.JWT_SECRET = 'recs-jwt';
  app = createApp({ env, redis });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', demandCapKw: 120, batteryFloorPct: 10 });
  await Device.create({ _id: bat, siteId, type: 'battery', name: 'Battery', profileId: 'sunspec-storage-802@2', ratedKw: 60, capacityKwh: 200, status: 'live' });
  await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-01-01' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, name: role === 'manager' ? 'Jamie Reyes' : role, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'recs-jwt');
    ids[role] = String(u._id);
  }
});

afterAll(async () => {
  sub.disconnect();
  await redis.flushdb();
  redis.disconnect();
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([Recommendation.deleteMany({}), Command.deleteMany({}), RuleConfig.deleteMany({}), AuditEvent.deleteMany({})]);
  await battery(68);
  events.length = 0;
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const settle = () => new Promise((r) => setTimeout(r, 100));

describe('reading', () => {
  it('lists open and closed decisions with counts, for every role', async () => {
    const open = await proposal();
    await proposal({ status: 'declined' });
    const res = await as('installer', request(app).get('/api/recommendations'));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([expect.objectContaining({ id: open, ruleTitle: 'Peak shaving', deviceName: 'Battery', status: 'proposed', expectedSavingCents: 26_600 })]);
    expect(res.body.counts).toEqual({ open: 1, closed: 1 });
    expect((await as('owner', request(app).get('/api/recommendations?state=closed'))).body.items).toEqual([expect.objectContaining({ status: 'declined' })]);
  });

  it('shows inputs, checks, calc, the payload and whether you may approve', async () => {
    const id = await proposal();
    const res = await as('manager', request(app).get(`/api/recommendations/${id}`));
    expect(res.body).toMatchObject({
      inputs: [{ label: 'Net peak forecast', value: '131 kW' }],
      calc: 'new peak 131 kW − current month peak 112 kW = 19 kW × $14/kW = $266',
      payload: { deviceId: String(bat), action: 'force_discharge', params: { kw: 25 } },
      canApprove: true,
    });
    const rec = (await Recommendation.findById(id).lean())!;
    expect(res.body.payload.expiresAt).toBe(new Date(rec.window.start!.getTime() + 15 * 60_000).toISOString());
    expect(res.body.payload.revertAt).toBe(rec.window.end!.toISOString());
    expect((await as('installer', request(app).get(`/api/recommendations/${id}`))).body.canApprove).toBe(false);
    expect((await as('owner', request(app).get('/api/recommendations/nope'))).status).toBe(404);
  });
});

describe('POST /:id/check', () => {
  it('reruns checks and saving for adjusted params without writing anything', async () => {
    const id = await proposal();
    const res = await as('manager', request(app).post(`/api/recommendations/${id}/check`)).send({ params: { kw: 70 } });
    expect(res.status).toBe(200);
    expect(res.body.allPass).toBe(false);
    expect(res.body.checks).toContainEqual({ text: 'Within the 60 kW discharge limit', pass: false });
    expect(res.body).toHaveProperty('expectedSavingCents');
    expect((await Recommendation.findById(id).lean())!.params).toMatchObject({ kw: 25 });
    expect((await as('installer', request(app).post(`/api/recommendations/${id}/check`)).send({})).status).toBe(403);
  });
});

describe('approve', () => {
  it('creates the Command, records who decided, and tells the Inbox', async () => {
    const id = await proposal();
    const res = await as('manager', request(app).post(`/api/recommendations/${id}/approve`)).send({ params: { kw: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toMatchObject({ status: 'approved', params: { kw: 30 }, decidedBy: { id: ids.manager, name: 'Jamie Reyes' }, canApprove: false });
    const rec = (await Recommendation.findById(id).lean())!;
    const cmd = (await Command.findById(res.body.commandId).lean())!;
    expect(cmd).toMatchObject({ deviceId: String(bat), action: 'force_discharge', status: 'created', recommendationId: rec._id, revertAt: rec.window.end });
    expect(cmd.params).toMatchObject({ kw: 30 });
    expect(cmd.expiresAt).toEqual(new Date(rec.window.start!.getTime() + 15 * 60_000));
    expect(String(rec.commandId)).toBe(res.body.commandId);
    expect(await AuditEvent.countDocuments({ action: 'recommendation.approve', target: `recommendation:${id}` })).toBe(1);
    await settle();
    expect(events).toEqual([
      { type: 'inbox', itemType: 'decide', itemId: id },
      { type: 'command', commandId: res.body.commandId, deviceId: String(bat), status: 'created' },
    ]);
    expect((await as('owner', request(app).post(`/api/recommendations/${id}/approve`)).send({})).status).toBe(409);
  });

  it('refuses with 409 and the failing check when the battery is too low now', async () => {
    const id = await proposal();
    await battery(20); // 20% − 25 kW × 1 h / 200 kWh ends at 8%
    const res = await as('owner', request(app).post(`/api/recommendations/${id}/approve`)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/^A check fails now: Battery stays at or above (30|15)% on (open|closed) days: ends at 8%$/);
    expect(res.body.error.details.checks).toContainEqual(expect.objectContaining({ pass: false }));
    expect((await Recommendation.findById(id).lean())!.status).toBe('proposed');
    expect(await Command.countDocuments()).toBe(0);
  });

  it('follows who may approve, and never lets installers', async () => {
    const id = await proposal();
    await RuleConfig.create({ siteId, ruleId: 'approval', params: { who: 'owner' } });
    expect((await as('manager', request(app).post(`/api/recommendations/${id}/approve`)).send({})).status).toBe(403);
    expect((await as('manager', request(app).get(`/api/recommendations/${id}`))).body.canApprove).toBe(false);
    expect((await as('installer', request(app).post(`/api/recommendations/${id}/approve`)).send({})).status).toBe(403);
    expect((await as('owner', request(app).post(`/api/recommendations/${id}/approve`)).send({})).status).toBe(200);
  });

  it('refuses an expired proposal, and lets only one of two approvers win', async () => {
    const late = await proposal({ expiresAt: new Date(Date.now() - 60_000) });
    expect((await as('owner', request(app).post(`/api/recommendations/${late}/approve`)).send({})).body.error.message).toBe('This proposal has expired');
    const id = await proposal();
    const both = await Promise.all(['owner', 'manager'].map((who) => as(who, request(app).post(`/api/recommendations/${id}/approve`)).send({})));
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await Command.countDocuments({ recommendationId: id })).toBe(1);
  });
});

describe('decline', () => {
  it('needs a reason, and records it', async () => {
    const id = await proposal();
    expect((await as('manager', request(app).post(`/api/recommendations/${id}/decline`)).send({})).status).toBe(400);
    const res = await as('manager', request(app).post(`/api/recommendations/${id}/decline`)).send({ reason: 'Buses need a full charge today' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'declined', declineReason: 'Buses need a full charge today' });
    expect(await AuditEvent.countDocuments({ action: 'recommendation.decline' })).toBe(1);
    expect((await as('owner', request(app).post(`/api/recommendations/${id}/decline`)).send({ reason: 'again' })).status).toBe(409);
    expect((await as('installer', request(app).post(`/api/recommendations/${id}/decline`)).send({ reason: 'nope nope' })).status).toBe(403);
  });
});

describe('manual requests (Devices page)', () => {
  const body = (over: object = {}) => ({
    deviceId: String(bat),
    action: 'set_reserve',
    params: { pct: 30 },
    window: { start: new Date(Date.now() + HOUR).toISOString(), end: new Date(Date.now() + 3 * HOUR).toISOString() },
    ...over,
  });

  it('go through the same kind of checks and wait for a decision', async () => {
    const res = await as('manager', request(app).post('/api/recommendations')).send(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ruleId: 'manual', ruleTitle: 'Manual request', status: 'proposed', title: 'set reserve · Battery', deviceName: 'Battery' });
    expect(res.body.inputs).toEqual([
      { label: 'Requested by', value: 'Jamie Reyes' },
      { label: 'Device', value: 'Battery' },
    ]);
    expect(res.body.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
    expect((await as('manager', request(app).post('/api/recommendations')).send(body({ window: res.body.window }))).status).toBe(409);
  });

  it('record failing checks, which then block approval', async () => {
    const res = await as('owner', request(app).post('/api/recommendations')).send(body({ params: { pct: 5 } }));
    expect(res.body.checks).toContainEqual({ text: 'Settings: pct must be at least 10%', pass: false });
    expect(res.body.checks).toContainEqual({ text: 'At least the 10% hardware minimum', pass: false });
    expect((await as('owner', request(app).post(`/api/recommendations/${res.body.id}/approve`)).send({})).status).toBe(409);
  });

  it('need a device of this site, a sane window, and an owner or manager', async () => {
    expect((await as('owner', request(app).post('/api/recommendations')).send(body({ deviceId: String(new mongoose.Types.ObjectId()) }))).status).toBe(404);
    const backwards = body({ window: { start: new Date(Date.now() + 2 * HOUR).toISOString(), end: new Date(Date.now() + HOUR).toISOString() } });
    expect((await as('owner', request(app).post('/api/recommendations')).send(backwards)).status).toBe(400);
    expect((await as('installer', request(app).post('/api/recommendations')).send(body())).status).toBe(403);
  });
});
