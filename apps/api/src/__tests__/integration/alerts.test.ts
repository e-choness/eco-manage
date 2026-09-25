/**
 * P2-08: Alerts API, button by button as Backend Coverage §3 describes them.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { Alert, AuditEvent, Command, Device, Maintenance, Membership, RuleMute, Site } from '@ecomanage/db';
import { siteEventsChannel, type CommandMessage } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { GatewayLink } from '../../lib/gatewayLink';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/8') || 'redis://redis:6379/8';
const siteId = new mongoose.Types.ObjectId();
const otherSite = new mongoose.Types.ObjectId();
const sid = String(siteId);
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const ev3 = new mongoose.Types.ObjectId();
const meter = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const userIds: Record<string, string> = {};
const HOUR = 3600_000;

const gateway = {
  commands: [] as { siteId: string; commandId: string; command: CommandMessage }[],
  up: true,
  async sendConfig() {
    return true;
  },
  async sendCommand(siteId: string, commandId: string, command: CommandMessage) {
    if (!this.up) return false;
    this.commands.push({ siteId, commandId, command });
    return true;
  },
  onConnect() {},
  async close() {},
};

let redis: Redis;
let sub: Redis;
const events: { type: string; alert?: { id: string; state: string }; status?: string }[] = [];
let app: ReturnType<typeof createApp>;

const alert = (over: object = {}) =>
  Alert.create({
    siteId,
    deviceId: String(ev3),
    ruleId: 'device-silent',
    severity: 'warning',
    title: 'Device not reporting',
    detail: 'EV charger 3: no data for 7 min',
    state: 'open',
    condition: 'active',
    openedAt: new Date(Date.now() - HOUR),
    lastSeenAt: new Date(),
    ...over,
  });

beforeAll(async () => {
  await connectTestDb('alerts');
  redis = new Redis(REDIS);
  await redis.flushdb();
  sub = redis.duplicate();
  await sub.subscribe(siteEventsChannel(sid));
  sub.on('message', (_c, m) => events.push(JSON.parse(m)));
  process.env.JWT_SECRET = 'alerts-jwt';
  app = createApp({ env, redis, gateway: gateway as unknown as GatewayLink });
  await Site.create([
    { _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' },
    { _id: otherSite, name: 'Other', tz: 'UTC' },
  ]);
  await Device.create([
    { _id: ev3, siteId, type: 'ev', name: 'EV charger 3', profileId: 'ocpp16-generic@1', status: 'offline' },
    { _id: meter, siteId, type: 'meter', name: 'Grid meter', profileId: 'ct-meter-3ph@2', status: 'live' },
  ]);
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, name: role === 'installer' ? 'Northside Solar' : role, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'alerts-jwt');
    userIds[role] = String(u._id);
  }
});

afterAll(async () => {
  sub.disconnect();
  await redis.flushdb();
  redis.disconnect();
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([Alert.deleteMany({}), RuleMute.deleteMany({}), Command.deleteMany({}), Maintenance.deleteMany({}), AuditEvent.deleteMany({})]);
  events.length = 0;
  gateway.commands.length = 0;
  gateway.up = true;
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const settle = () => new Promise((r) => setTimeout(r, 100));

describe('GET /api/alerts', () => {
  it('lists open (and acknowledged) or closed alerts, newest first, with counts', async () => {
    const older = await alert({ openedAt: new Date(Date.now() - 3 * HOUR), deviceId: String(meter), ruleId: 'demand-near-cap' });
    const acked = await alert({ state: 'ack' });
    await alert({ state: 'resolved', condition: 'cleared', openedAt: new Date(Date.now() - 48 * HOUR) });
    await Alert.create({ siteId: otherSite, deviceId: null, ruleId: 'gateway-buffer', severity: 'warning', title: 'x', state: 'open', openedAt: new Date(), lastSeenAt: new Date() });

    const open = await as('installer', request(app).get('/api/alerts'));
    expect(open.status).toBe(200);
    expect(open.body.items.map((a: { id: string }) => a.id)).toEqual([String(acked._id), String(older._id)]);
    expect(open.body.counts).toEqual({ open: 2, closed: 1 });
    const closed = await as('manager', request(app).get('/api/alerts?state=closed'));
    expect(closed.body.items).toEqual([expect.objectContaining({ state: 'resolved', condition: 'cleared' })]);

    const page = await as('owner', request(app).get(`/api/alerts?limit=1&before=${encodeURIComponent(acked.openedAt.toISOString())}`));
    expect(page.body.items.map((a: { id: string }) => a.id)).toEqual([String(older._id)]);
    expect((await as('owner', request(app).get('/api/alerts?state=all'))).status).toBe(400);
  });
});

describe('GET /api/alerts/:id', () => {
  it('shows the device, the profile’s fixes and which buttons apply', async () => {
    const a = await alert();
    const res = await as('installer', request(app).get(`/api/alerts/${a._id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: String(a._id),
      deviceName: 'EV charger 3',
      fixes: [{ id: 'soft-reset', label: 'Remote restart (OCPP soft reset)' }],
      actions: { ack: true, snooze: true, fix: true, resolve: false, falseAlarm: true },
      ackBy: null,
      resolution: null,
    });
  });

  it('is 404 for another site’s alert or a malformed id', async () => {
    const other = await Alert.create({ siteId: otherSite, ruleId: 'gateway-buffer', severity: 'warning', title: 'x', openedAt: new Date(), lastSeenAt: new Date() });
    expect((await as('owner', request(app).get(`/api/alerts/${other._id}`))).status).toBe(404);
    expect((await as('owner', request(app).get('/api/alerts/nope'))).status).toBe(404);
  });
});

describe('acknowledge', () => {
  it('records who and when, keeps the alert open, and tells the live stream', async () => {
    const a = await alert();
    const res = await as('installer', request(app).post(`/api/alerts/${a._id}/ack`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'ack', condition: 'active' });
    const detail = await as('owner', request(app).get(`/api/alerts/${a._id}`));
    expect(detail.body).toMatchObject({ ackBy: { id: userIds.installer, name: 'Northside Solar' }, ackAt: expect.any(String), actions: { ack: false } });
    expect(await AuditEvent.countDocuments({ action: 'alert.ack', target: `alert:${a._id}` })).toBe(1);
    await settle();
    expect(events).toEqual([{ type: 'alert', alert: expect.objectContaining({ id: String(a._id), state: 'ack' }) }]);
    expect((await as('owner', request(app).post(`/api/alerts/${a._id}/ack`))).status).toBe(409);
  });
});

describe('pause emails', () => {
  it('snoozes for 24 h while the condition is true, and only then', async () => {
    const a = await alert();
    const before = Date.now();
    const res = await as('manager', request(app).post(`/api/alerts/${a._id}/snooze`));
    expect(res.status).toBe(200);
    const until = (await Alert.findById(a._id).lean())!.snoozedUntil!.getTime();
    expect(until - before).toBeGreaterThanOrEqual(24 * HOUR - 1000);
    expect(until - before).toBeLessThan(24 * HOUR + 5000);
    const cleared = await alert({ ruleId: 'command-ack-slow', condition: 'cleared' });
    expect((await as('manager', request(app).post(`/api/alerts/${cleared._id}/snooze`))).status).toBe(409);
  });
});

describe('resolve', () => {
  it('refuses while the condition is still true', async () => {
    const a = await alert();
    const res = await as('owner', request(app).post(`/api/alerts/${a._id}/resolve`)).send({ cause: 'Fixed on site', note: 'Replugged' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 409, details: { condition: 'active' } });
    expect((await Alert.findById(a._id).lean())!.state).toBe('open');
  });

  it('closes a cleared alert with cause and note, and logs it on the device', async () => {
    const a = await alert({ ruleId: 'command-ack-slow', condition: 'cleared', title: 'Command confirmed late' });
    const res = await as('installer', request(app).post(`/api/alerts/${a._id}/resolve`)).send({ cause: 'Known issue', note: 'Charger firmware is slow to confirm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alert: expect.objectContaining({ state: 'resolved', resolvedAt: expect.any(String) }), mute: null });
    const detail = await as('owner', request(app).get(`/api/alerts/${a._id}`));
    expect(detail.body.resolution).toEqual({ cause: 'Known issue', note: 'Charger firmware is slow to confirm', by: { id: userIds.installer, name: 'Northside Solar' }, auto: false });
    expect(await Maintenance.findOne({ deviceId: String(ev3) }).lean()).toMatchObject({ source: 'alert', text: 'Command confirmed late: Known issue. Charger firmware is slow to confirm' });
    const device = await as('installer', request(app).get(`/api/devices/${ev3}`));
    expect(device.body.maintenance).toEqual([{ at: expect.any(String), source: 'alert', text: 'Command confirmed late: Known issue. Charger firmware is slow to confirm' }]);
    expect(await AuditEvent.countDocuments({ action: 'alert.resolve' })).toBe(1);
    expect((await as('owner', request(app).post(`/api/alerts/${a._id}/resolve`)).send({ cause: 'Known issue' })).status).toBe(409);
  });

  it('false alarm: closes it anyway, mutes the check for the device for 7 days and flags it', async () => {
    const a = await alert();
    const res = await as('manager', request(app).post(`/api/alerts/${a._id}/resolve`)).send({ cause: 'False alarm', note: 'Charger is unplugged for the holidays' });
    expect(res.status).toBe(200);
    expect(res.body.alert).toMatchObject({ state: 'resolved' });
    const mute = await RuleMute.findOne({ siteId }).lean();
    expect(mute).toMatchObject({ deviceId: String(ev3), ruleId: 'device-silent', review: true, alertId: a._id });
    expect(mute!.until.getTime() - Date.now()).toBeGreaterThan(7 * 24 * HOUR - 60_000);
    expect(res.body.mute).toEqual({ until: mute!.until.toISOString() });
    expect(await AuditEvent.findOne({ action: 'alert.false-alarm' }).lean()).toMatchObject({ after: { cause: 'False alarm', muteUntil: mute!.until.toISOString() } });
  });

  it('needs a known cause', async () => {
    const a = await alert({ condition: 'cleared' });
    expect((await as('owner', request(app).post(`/api/alerts/${a._id}/resolve`)).send({ cause: 'Gremlins' })).status).toBe(400);
    expect((await as('owner', request(app).post(`/api/alerts/${a._id}/resolve`)).send({})).status).toBe(400);
  });
});

describe('remote fix', () => {
  it('sends the profile’s fix to the gateway as a Command', async () => {
    const a = await alert();
    const res = await as('installer', request(app).post(`/api/alerts/${a._id}/fix`)).send({ fixId: 'soft-reset' });
    expect(res.status).toBe(202);
    expect(res.body.command).toMatchObject({ deviceId: String(ev3), action: 'reset', status: 'sent', sentAt: expect.any(String) });
    expect(gateway.commands).toEqual([
      { siteId: sid, commandId: res.body.command.id, command: { deviceId: String(ev3), action: 'reset', params: {}, expiresAt: res.body.command.expiresAt, revertAt: null } },
    ]);
    expect(Date.parse(res.body.command.expiresAt) - Date.now()).toBeLessThanOrEqual(2 * 60_000);
    expect(await Command.findById(res.body.command.id).lean()).toMatchObject({ alertId: a._id, status: 'sent' });
    expect(await AuditEvent.countDocuments({ action: 'alert.fix' })).toBe(1);
    await settle();
    expect(events).toContainEqual(expect.objectContaining({ type: 'command', status: 'sent' }));
  });

  it('only offers fixes from the profile, while the condition is true', async () => {
    const a = await alert();
    expect((await as('owner', request(app).post(`/api/alerts/${a._id}/fix`)).send({ fixId: 'format-disk' })).status).toBe(422);
    const noFix = await alert({ deviceId: String(meter), ruleId: 'demand-near-cap' });
    expect((await as('owner', request(app).post(`/api/alerts/${noFix._id}/fix`)).send({ fixId: 'restart' })).status).toBe(409);
    const cleared = await alert({ ruleId: 'command-ack-slow', condition: 'cleared' });
    expect((await as('owner', request(app).post(`/api/alerts/${cleared._id}/fix`)).send({ fixId: 'soft-reset' })).status).toBe(409);
    expect(gateway.commands).toEqual([]);
  });

  it('answers 503 and records a failed command when the gateway can’t be reached', async () => {
    gateway.up = false;
    const a = await alert();
    const res = await as('owner', request(app).post(`/api/alerts/${a._id}/fix`)).send({ fixId: 'soft-reset' });
    expect(res.status).toBe(503);
    expect(res.body.error.details.command).toMatchObject({ status: 'failed', error: 'Could not reach the gateway' });
  });
});
