/**
 * P1-09: v2 devices — list, detail, telemetry with downsampling, and installer-only writes with
 * audit events. Real MongoDB and Redis.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Redis } from 'ioredis';
import { AuditEvent, Device, Membership, Site, Telemetry } from '@ecomanage/db';
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, type DeviceDetail, type DeviceView, type TelemetrySeries } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/5') || 'redis://redis:6379/5';
const OTHER_SITE = '650000000000000000000099';
const OTHER_DEVICE = '650000000000000000009901';
const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!;

let redis: Redis;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
let installerId = '';

beforeAll(async () => {
  await connectTestDb('devices');
  redis = new Redis(REDIS);
  await redis.flushdb();
  process.env.JWT_SECRET = 'dev-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 }, redis });

  await Site.create([{ _id: DEMO_SITE_ID, ...DEMO_SITE }, { _id: OTHER_SITE, name: 'Other' }]);
  const password = await generatePasswordHash('pw123456');
  for (const role of ['installer', 'manager'] as const) {
    const u = await User.create({ email: `${role}@example.com`, name: role === 'installer' ? 'Northside Solar' : 'Jamie', password });
    await Membership.create({ userId: u._id, siteId: DEMO_SITE_ID, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'dev-jwt');
    if (role === 'installer') installerId = String(u._id);
  }
});

beforeEach(async () => {
  await Promise.all([Device.deleteMany({}), Telemetry.deleteMany({}), AuditEvent.deleteMany({})]);
  await Device.insertMany([
    ...DEMO_DEVICES.map((d) => ({
      _id: d.id,
      siteId: DEMO_SITE_ID,
      type: d.type,
      name: d.name,
      profileId: d.profileId,
      address: d.address,
      role: d.role,
      status: 'live',
      ratedKw: d.ratedKw,
      commissionedAt: new Date('2024-03-14T15:00:00Z'),
      commissionedBy: installerId,
    })),
    { _id: OTHER_DEVICE, siteId: OTHER_SITE, type: 'meter', name: 'Their meter', status: 'live' },
  ]);
  await redis.set(`latest:${dev('invA').id}`, JSON.stringify({ ts: '2026-09-24T16:40:02Z', p_kw: 36.1, q: 'ok' }));
});

afterAll(async () => {
  await redis.flushdb();
  await redis.quit();
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('reading', () => {
  it('lists the site’s devices with latest reading and quality, never another site’s', async () => {
    const res = await as('manager', request(app).get('/api/devices'));
    expect(res.status).toBe(200);
    const items = res.body.items as DeviceView[];
    expect(items).toHaveLength(DEMO_DEVICES.length);
    expect(items.map((d) => d.id)).not.toContain(OTHER_DEVICE);
    const invA = items.find((d) => d.id === dev('invA').id)!;
    expect(invA).toMatchObject({ name: 'Inverter A', type: 'pv', status: 'live', quality: 'ok', latest: { p_kw: 36.1 } });
    expect(items.find((d) => d.id === dev('meter').id)).toMatchObject({ latest: null, quality: null });
  });

  it('shows detail with the profile and who commissioned it', async () => {
    const res = await as('manager', request(app).get(`/api/devices/${dev('ev3').id}`));
    const d = res.body as DeviceDetail;
    expect(d.commissionedBy).toEqual({ id: installerId, name: 'Northside Solar' });
    expect(d.profile).toMatchObject({ id: 'ocpp16-generic@1', protocol: 'ocpp-1.6j', fixes: ['Remote restart (OCPP soft reset)'] });
    expect(d.profile?.writeActions).toContain('limit_current');
  });

  it('answers 404 for unknown ids, malformed ids and other sites’ devices', async () => {
    for (const id of ['650000000000000000000199', 'nope', OTHER_DEVICE]) {
      const res = await as('manager', request(app).get(`/api/devices/${id}`));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 404, message: 'Device not found' } });
    }
  });
});

describe('telemetry', () => {
  const insertMinutes = async (fromIso: string, minutes: number, perMinute = 12, estimatedMinute = -1) => {
    const t0 = Date.parse(fromIso);
    const docs = [];
    for (let m = 0; m < minutes; m++)
      for (let i = 0; i < perMinute; i++)
        docs.push({
          ts: new Date(t0 + m * 60_000 + i * (60_000 / perMinute)),
          meta: { siteId: DEMO_SITE_ID, deviceId: dev('invA').id },
          p_kw: m % 60, // each hour: 0..59
          q: m === estimatedMinute ? 'estimated' : 'ok',
        });
    await Telemetry.insertMany(docs);
  };

  it('downsamples to hourly buckets with average, min, max and counts', async () => {
    await insertMinutes('2026-09-24T00:00:00Z', 24 * 60, 12, 90)
    const res = await as('manager', request(app).get(`/api/devices/${dev('invA').id}/telemetry`).query({ from: '2026-09-24T00:00:00Z', to: '2026-09-25T00:00:00Z' }));
    const s = res.body as TelemetrySeries;
    expect(res.status).toBe(200);
    expect(s).toMatchObject({ res: 'h', capped: false });
    expect(s.points).toHaveLength(24);
    expect(s.points[0]).toEqual({ ts: '2026-09-24T00:00:00.000Z', p_kw: 29.5, min_kw: 0, max_kw: 59, n: 720, estimated: false });
    expect(s.points[1].estimated).toBe(true); // minute 90 is in the second hour
  });

  it('falls back to a coarser resolution when the requested one exceeds 400 points', async () => {
    await insertMinutes('2026-09-24T00:00:00Z', 48 * 60, 1)
    // 48 h at 5 min would be 576 points; 15 min gives 192
    const five = await as('manager', request(app).get(`/api/devices/${dev('invA').id}/telemetry`).query({ from: '2026-09-24T00:00:00Z', to: '2026-09-26T00:00:00Z', res: '5m' }));
    expect(five.body).toMatchObject({ res: '15m', capped: true });
    expect(five.body.points).toHaveLength(192);
    const raw = await as('manager', request(app).get(`/api/devices/${dev('invA').id}/telemetry`).query({ from: '2026-09-24T10:00:00Z', to: '2026-09-24T12:00:00Z', res: 'raw' }));
    expect(raw.body).toMatchObject({ res: 'raw', capped: false });
    expect(raw.body.points).toHaveLength(120);
  });

  it('rejects bad ranges and queries', async () => {
    const url = `/api/devices/${dev('invA').id}/telemetry`;
    expect((await as('manager', request(app).get(url).query({ from: '2026-09-25T00:00:00Z', to: '2026-09-24T00:00:00Z' }))).status).toBe(400);
    expect((await as('manager', request(app).get(url).query({ from: '2026-08-01T00:00:00Z', to: '2026-09-24T00:00:00Z' }))).body.error.message).toMatch(/16 days/);
    expect((await as('manager', request(app).get(url).query({ res: 'week' }))).status).toBe(400);
    expect((await as('manager', request(app).get(`/api/devices/${OTHER_DEVICE}/telemetry`))).status).toBe(404);
  });

  it('defaults to the last 24 hours', async () => {
    await insertMinutes(new Date(Date.now() - 3 * 3_600_000).toISOString(), 60, 1)
    const res = await as('manager', request(app).get(`/api/devices/${dev('invA').id}/telemetry`));
    expect(res.body.res).toBe('h');
    expect(res.body.points.reduce((n: number, p: { n: number }) => n + p.n, 0)).toBe(60);
  });
});

describe('writes (installer only)', () => {
  it('adds a scanned device as pending, with an audit event', async () => {
    const res = await as('installer', request(app).post('/api/devices')).send({
      type: 'submeter',
      name: 'Sub-meter · kitchen',
      profileId: 'ct-meter-3ph@2',
      address: 'RS-485 · id 7',
      role: 'submeter',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', siteId: DEMO_SITE_ID, profileId: 'ct-meter-3ph@2' });
    const audit = await AuditEvent.findOne({ action: 'device.create' }).lean();
    expect(audit).toMatchObject({ target: `device:${res.body.id}`, after: { name: 'Sub-meter · kitchen' } });
    expect(String(audit?.userId)).toBe(installerId);
  });

  it('refuses unknown profiles and profiles for another device type', async () => {
    const bad = (profileId: string) => as('installer', request(app).post('/api/devices')).send({ type: 'pv', name: 'X', profileId });
    expect((await bad('nope@1')).body).toEqual({ error: { code: 400, message: 'Unknown device profile' } });
    expect((await bad('ct-meter-3ph@2')).body).toEqual({ error: { code: 400, message: 'The profile does not support this device type' } });
    expect((await as('installer', request(app).post('/api/devices')).send({ type: 'wind', name: 'X' })).status).toBe(400);
  });

  it('renames a device and records before and after', async () => {
    const res = await as('installer', request(app).patch(`/api/devices/${dev('invB').id}`)).send({ name: 'Roof west', ratedKw: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Roof west', ratedKw: 42 });
    const audit = await AuditEvent.findOne({ action: 'device.update' }).lean();
    expect(audit).toMatchObject({ before: { name: 'Inverter B', ratedKw: 40 }, after: { name: 'Roof west', ratedKw: 42 } });
  });

  it('rejects empty, unknown or forbidden fields and other sites’ devices', async () => {
    const patch = (id: string, body: object) => as('installer', request(app).patch(`/api/devices/${id}`)).send(body);
    expect((await patch(dev('invB').id, {})).status).toBe(400);
    expect((await patch(dev('invB').id, { status: 'live' })).status).toBe(400);
    expect((await patch(dev('invB').id, { siteId: OTHER_SITE })).status).toBe(400);
    expect((await patch(OTHER_DEVICE, { name: 'mine now' })).status).toBe(404);
    expect((await Device.findById(OTHER_DEVICE).lean())?.name).toBe('Their meter');
  });

  it('removes a device and keeps its audit trail', async () => {
    const res = await as('installer', request(app).delete(`/api/devices/${dev('ev4').id}`));
    expect(res.status).toBe(204);
    expect(await Device.exists({ _id: dev('ev4').id })).toBeNull();
    expect(await AuditEvent.countDocuments({ action: 'device.delete', target: `device:${dev('ev4').id}` })).toBe(1);
    expect((await as('installer', request(app).delete(`/api/devices/${OTHER_DEVICE}`))).status).toBe(404);
  });

  it('is refused for managers', async () => {
    const res = await as('manager', request(app).patch(`/api/devices/${dev('invB').id}`)).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(await AuditEvent.countDocuments()).toBe(0);
  });
});
