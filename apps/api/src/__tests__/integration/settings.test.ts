/**
 * P2-06: site settings (site, solar arrays, battery, gateway card) and the calendar, with the
 * App v2 role rules. The gateway link is a stand-in that records what would go over MQTT.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { AuditEvent, Calendar, Device, Membership, Site } from '@ecomanage/db';
import { DEMO_CALENDAR_INPUT, DEMO_DEVICES, DEMO_SITE } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { GatewayLink } from '../../lib/gatewayLink';
import { syncPendingGatewayConfigs } from '../../modules/site/settings';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/6') || 'redis://redis:6379/6';
const siteId = new mongoose.Types.ObjectId();
const sid = String(siteId);
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const DEVICES = DEMO_DEVICES.map((d) => ({ ...d, id: new mongoose.Types.ObjectId().toString() }));
const dev = (key: string) => DEVICES.find((d) => d.key === key)!;
const tokens: Record<string, string> = {};

const gateway = {
  sent: [] as { siteId: string; config: unknown }[],
  up: true,
  async sendConfig(siteId: string, config: unknown) {
    if (!this.up) return false;
    this.sent.push({ siteId, config });
    return true;
  },
  onConnect() {},
  async close() {},
};

let redis: Redis;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('settings');
  redis = new Redis(REDIS);
  await redis.flushdb();
  process.env.JWT_SECRET = 'settings-jwt';
  app = createApp({ env, redis, gateway: gateway as unknown as GatewayLink });
  const { id: _id, ...site } = DEMO_SITE;
  await Site.create({ _id: siteId, ...site });
  await Device.insertMany(DEVICES.map((d) => ({ _id: d.id, siteId, type: d.type, name: d.name, ratedKw: d.ratedKw, capacityKwh: d.capacityKwh, status: 'live' })));
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'settings-jwt');
  }
});

afterAll(async () => {
  await redis.flushdb();
  redis.disconnect();
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('GET /api/site', () => {
  it('shows every role the site, its arrays and its battery', async () => {
    for (const who of ['owner', 'manager', 'installer']) {
      const res = await as(who, request(app).get('/api/site'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: sid,
        name: 'Maple Grove School',
        tz: 'America/Toronto',
        currency: 'CAD',
        billDay: 1,
        demandCapKw: 120,
        pvArrays: [],
        battery: { deviceId: dev('bat').id, usableKwh: 200, maxKw: 60, floorPct: 10 },
      });
    }
  });
});

describe('PATCH /api/site', () => {
  it('lets the owner change details, auditing only what changed', async () => {
    const res = await as('owner', request(app).patch('/api/site')).send({ name: 'Maple Grove PS', demandCapKw: 110, currency: 'CAD' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Maple Grove PS', demandCapKw: 110 });
    const audit = await AuditEvent.findOne({ action: 'site.update' }).lean();
    expect(audit).toMatchObject({ before: { name: 'Maple Grove School', demandCapKw: 120 }, after: { name: 'Maple Grove PS', demandCapKw: 110 } });
  });

  it('validates time zone, billing day, location and unknown fields', async () => {
    for (const body of [{ tz: 'Mars/Olympus' }, { billDay: 29 }, { lat: 91 }, { currency: 'JPY' }, { colour: 'red' }, {}]) {
      const res = await as('owner', request(app).patch('/api/site')).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(400);
    }
    const tz = await as('owner', request(app).patch('/api/site')).send({ tz: 'Mars/Olympus' });
    expect(tz.body.error.details.issues[0]).toEqual({ path: 'tz', message: 'unknown time zone' });
  });

  it('is owner-only', async () => {
    for (const who of ['manager', 'installer']) expect((await as(who, request(app).patch('/api/site')).send({ name: 'x' })).status).toBe(403);
  });
});

describe('PUT /api/site/pv-arrays', () => {
  const arrays = () => [
    { name: 'Roof east', inverterId: dev('invA').id, kwp: 48, tiltDeg: 10, azimuthDeg: 180 },
    { name: 'Roof west', inverterId: dev('invB').id, kwp: 38, tiltDeg: 10, azimuthDeg: 180 },
  ];

  it('lets the installer replace the table; each array gets an id', async () => {
    const res = await as('installer', request(app).put('/api/site/pv-arrays')).send(arrays());
    expect(res.status).toBe(200);
    expect(res.body.pvArrays).toHaveLength(2);
    expect(res.body.pvArrays[0]).toMatchObject({ name: 'Roof east', kwp: 48, id: expect.any(String) });
    // Keeping an id keeps the array
    const again = await as('owner', request(app).put('/api/site/pv-arrays')).send([{ ...arrays()[0], id: res.body.pvArrays[0].id, kwp: 50 }]);
    expect(again.body.pvArrays).toEqual([{ ...arrays()[0], id: res.body.pvArrays[0].id, kwp: 50 }]);
    expect(await AuditEvent.countDocuments({ action: 'site.pv-arrays' })).toBe(2);
  });

  it('needs one of the site’s inverters, and sane geometry', async () => {
    const wrong = await as('owner', request(app).put('/api/site/pv-arrays')).send([{ ...arrays()[0], inverterId: dev('bat').id }]);
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.issues).toEqual([{ index: 0, field: 'inverterId', message: 'Roof east: not an inverter of this site' }]);
    expect((await as('owner', request(app).put('/api/site/pv-arrays')).send([{ ...arrays()[0], tiltDeg: 95 }])).status).toBe(400);
  });

  it('is closed to managers', async () => {
    expect((await as('manager', request(app).put('/api/site/pv-arrays')).send(arrays())).status).toBe(403);
  });
});

describe('PATCH /api/site/battery', () => {
  it('updates the battery and sends a new floor to the gateway', async () => {
    const res = await as('installer', request(app).patch('/api/site/battery')).send({ usableKwh: 190, floorPct: 15 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ battery: { usableKwh: 190, maxKw: 60, floorPct: 15 }, gatewaySync: 'sent' });
    expect(gateway.sent.at(-1)).toEqual({ siteId: sid, config: { batteryFloorPct: 15 } });
    expect((await Device.findById(dev('bat').id).lean())!.capacityKwh).toBe(190);
    expect(await AuditEvent.countDocuments({ action: 'site.battery' })).toBe(1);
  });

  it('does not bother the gateway when the floor is unchanged', async () => {
    const before = gateway.sent.length;
    const res = await as('owner', request(app).patch('/api/site/battery')).send({ maxKw: 55, floorPct: 15 });
    expect(res.body).toMatchObject({ battery: { maxKw: 55 }, gatewaySync: 'unchanged' });
    expect(gateway.sent).toHaveLength(before);
  });

  it('keeps an unsent floor pending and sends it on reconnect', async () => {
    gateway.up = false;
    const res = await as('owner', request(app).patch('/api/site/battery')).send({ floorPct: 20 });
    expect(res.body).toMatchObject({ gatewaySync: 'pending', battery: { floorPct: 20 } });
    expect((await as('owner', request(app).get('/api/site/gateway'))).body).toMatchObject({ batteryFloorPct: 20, configPending: true });
    gateway.up = true;
    expect(await syncPendingGatewayConfigs(gateway as unknown as GatewayLink)).toBe(1);
    expect(gateway.sent.at(-1)).toEqual({ siteId: sid, config: { batteryFloorPct: 20 } });
    expect((await Site.findById(siteId).lean())!.gatewayConfigPending).toBe(false);
  });

  it('refuses a floor under 10%, managers, and sites without a battery', async () => {
    const low = await as('owner', request(app).patch('/api/site/battery')).send({ floorPct: 5 });
    expect(low.status).toBe(400);
    expect(low.body.error.message).toBe('The hardware minimum reserve must be at least 10%');
    expect((await as('manager', request(app).patch('/api/site/battery')).send({ floorPct: 20 })).status).toBe(403);
    await Device.updateOne({ _id: dev('bat').id }, { $set: { type: 'meter' } });
    try {
      expect((await as('owner', request(app).patch('/api/site/battery')).send({ floorPct: 20 })).status).toBe(404);
    } finally {
      await Device.updateOne({ _id: dev('bat').id }, { $set: { type: 'battery' } });
    }
  });
});

describe('GET /api/site/gateway', () => {
  it('reports what the gateway last said, and whether it is online', async () => {
    const receivedAt = new Date().toISOString();
    await redis.set(`gw:${sid}`, JSON.stringify({ fw: '1.4.2', uptimeS: 3600, buffered: 0, oldestBufferedTs: null, clockOffsetMs: 12, receivedAt }));
    const res = await as('manager', request(app).get('/api/site/gateway'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'gw-maple-01',
      online: true,
      fw: '1.4.2',
      uptimeS: 3600,
      buffered: 0,
      oldestBufferedTs: null,
      clockOffsetMs: 12,
      lastSeenAt: receivedAt,
      bufferDays: 7,
      batteryFloorPct: 20,
      configPending: false,
    });
    await redis.set(`gw:${sid}`, JSON.stringify({ fw: '1.4.2', buffered: 40, receivedAt: new Date(Date.now() - 5 * 60_000).toISOString() }));
    expect((await as('installer', request(app).get('/api/site/gateway'))).body).toMatchObject({ online: false, buffered: 40 });
  });
});

describe('calendar', () => {
  it('starts empty: weekends closed, no terms', async () => {
    const res = await as('installer', request(app).get('/api/calendar'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ terms: [], daysOff: [], open: '08:00', close: '17:00', weekends: 'closed', updatedAt: null });
  });

  it('lets a manager replace it, sorted by date, and audits it', async () => {
    const input = { ...DEMO_CALENDAR_INPUT, terms: [...DEMO_CALENDAR_INPUT.terms].reverse() };
    const res = await as('manager', request(app).put('/api/calendar')).send(input);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...DEMO_CALENDAR_INPUT, updatedAt: expect.any(String) });
    expect(res.body.terms.map((t: { name: string }) => t.name)).toEqual(['Fall term', 'Winter term', 'Spring term']);
    expect(await Calendar.countDocuments({ siteId })).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'calendar.update' })).toBe(1);
    expect((await as('owner', request(app).put('/api/calendar')).send(DEMO_CALENDAR_INPUT)).status).toBe(200);
    expect(await Calendar.countDocuments({ siteId })).toBe(1);
  });

  it('rejects reversed ranges, bad dates and closing before opening', async () => {
    const bad = await as('owner', request(app).put('/api/calendar')).send({ ...DEMO_CALENDAR_INPUT, daysOff: [{ name: 'Oops', start: '2026-10-12', end: '2026-10-09' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0]).toEqual({ path: 'daysOff.0.end', message: 'start must not be after end' });
    for (const body of [
      { ...DEMO_CALENDAR_INPUT, terms: [{ name: 'T', start: '2026-02-30', end: '2026-03-01' }] },
      { ...DEMO_CALENDAR_INPUT, open: '18:00' },
      { ...DEMO_CALENDAR_INPUT, weekends: 'sometimes' },
    ])
      expect((await as('owner', request(app).put('/api/calendar')).send(body)).status).toBe(400);
  });

  it('is read-only for installers', async () => {
    expect((await as('installer', request(app).put('/api/calendar')).send(DEMO_CALENDAR_INPUT)).status).toBe(403);
  });
});
