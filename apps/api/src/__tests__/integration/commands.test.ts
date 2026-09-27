/**
 * P3-04: /api/commands: what is running, and cancelling early (a revert when it was already out).
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Command, Device, Membership, Recommendation, Site, type CommandDoc } from '@ecomanage/db';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const bat = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const HOUR = 3_600_000;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('commands');
  process.env.JWT_SECRET = 'cmd-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  await Device.create({ _id: bat, siteId, type: 'battery', name: 'Battery', status: 'live' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'cmd-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([Command.deleteMany({}), Recommendation.deleteMany({}), AuditEvent.deleteMany({})]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

const command = async (status: CommandDoc['status'], over: object = {}) => {
  const rec = await Recommendation.create({
    siteId,
    ruleId: 'peak-shaving',
    dedupeKey: `k${Math.random()}`,
    deviceId: String(bat),
    action: 'force_discharge',
    title: 'Discharge battery at 30 kW, 14:00–17:00',
    window: { start: new Date(Date.now() + HOUR), end: new Date(Date.now() + 4 * HOUR) },
    status: status === 'created' ? 'approved' : status,
    proposedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  const c = await Command.create({
    siteId,
    deviceId: String(bat),
    recommendationId: rec._id,
    action: 'force_discharge',
    params: { kw: 30 },
    sendAt: new Date(Date.now() + HOUR),
    expiresAt: new Date(Date.now() + HOUR + 15 * 60_000),
    revertAt: new Date(Date.now() + 4 * HOUR),
    status,
    ...over,
  });
  await Recommendation.updateOne({ _id: rec._id }, { $set: { commandId: c._id } });
  return { id: String(c._id), rec: String(rec._id) };
};

describe('GET /api/commands', () => {
  it('lists what is waiting or running, with its recommendation, for every role', async () => {
    const waiting = await command('created');
    const running = await command('verified');
    await command('reverted');
    const res = await as('installer', request(app).get('/api/commands'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id).sort()).toEqual([waiting.id, running.id].sort());
    expect(res.body.items[0]).toMatchObject({ deviceName: 'Battery', action: 'force_discharge', recommendation: { title: 'Discharge battery at 30 kW, 14:00–17:00' }, revert: null });
    expect((await as('owner', request(app).get(`/api/commands/${running.id}`))).body).toMatchObject({ id: running.id, status: 'verified' });
    expect((await as('owner', request(app).get('/api/commands/nope'))).status).toBe(404);
  });
});

describe('POST /api/commands/:id/cancel', () => {
  it('drops a command that has not gone out yet', async () => {
    const { id, rec } = await command('created');
    const res = await as('manager', request(app).post(`/api/commands/${id}/cancel`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', revert: null, cancelledAt: expect.any(String) });
    expect(await Command.countDocuments({ revertOf: id })).toBe(0);
    expect((await Recommendation.findById(rec).lean())!.status).toBe('cancelled');
    expect(await AuditEvent.countDocuments({ action: 'command.cancel' })).toBe(1);
  });

  it('asks for a revert when the command is already running', async () => {
    const { id } = await command('verified', { sentAt: new Date(), ackedAt: new Date() });
    const res = await as('owner', request(app).post(`/api/commands/${id}/cancel`));
    expect(res.body).toMatchObject({ status: 'cancelled', revert: { action: 'revert', status: 'created' } });
    const revert = (await Command.findOne({ revertOf: id }).lean())!;
    expect(revert).toMatchObject({ deviceId: String(bat), action: 'revert', status: 'created', sendAt: null });
  });

  it('reverts a reserve change back to the reserve it had', async () => {
    const { id } = await command('acked', { action: 'set_reserve', params: { pct: 80 }, revertParams: { pct: 20 } });
    await as('owner', request(app).post(`/api/commands/${id}/cancel`));
    expect(await Command.findOne({ revertOf: id }).lean()).toMatchObject({ action: 'set_reserve', params: { pct: 20 } });
  });

  it('refuses finished commands, reverts themselves, and installers', async () => {
    const done = await command('reverted');
    expect((await as('owner', request(app).post(`/api/commands/${done.id}/cancel`))).status).toBe(409);
    const running = await command('verified');
    await as('owner', request(app).post(`/api/commands/${running.id}/cancel`));
    const revert = (await Command.findOne({ revertOf: running.id }).lean())!;
    expect((await as('owner', request(app).post(`/api/commands/${revert._id}/cancel`))).status).toBe(409);
    expect((await as('installer', request(app).post(`/api/commands/${(await command('created')).id}/cancel`))).status).toBe(403);
  });
});
