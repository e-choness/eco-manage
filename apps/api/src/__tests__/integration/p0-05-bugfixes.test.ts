/**
 * P0-05: one test per bug from spec §9, against a real MongoDB. Each test failed on the P0-04
 * code and passes after the fix.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { connectTestDb, countQueries, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import Device from '../../modules/devices/model';
import EnergyReading from '../../modules/analytics/model';
import Recommendation from '../../modules/optimization/model';
import * as dashboard from '../../modules/dashboard/service';
import { generatePasswordHash } from '../../utils/password';

const NOW = new Date('2026-09-24T12:30:00Z');
const at = (iso: string) => new Date(iso);
const userId = new mongoose.Types.ObjectId();

type DeviceKey = 'solarA' | 'solarB' | 'wind' | 'battery' | 'meter';
let ids: Record<DeviceKey, mongoose.Types.ObjectId>;

const reading = (device: DeviceKey, timestamp: Date, value: number, type: 'production' | 'consumption' = 'production') => ({
  userId,
  deviceId: ids[device],
  timestamp,
  value,
  type,
});

const hours = (day: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => at(`${day}T${String(from + i).padStart(2, '0')}:00:00Z`));

const seedSite = async () => {
  const devices = await Device.create([
    { userId, name: 'Solar A', type: 'solar', status: 'online', maxOutput: 5 },
    { userId, name: 'Solar B', type: 'solar', status: 'online', maxOutput: 5 },
    { userId, name: 'Wind', type: 'wind', status: 'online', maxOutput: 10 },
    { userId, name: 'Battery', type: 'battery', status: 'charging', maxOutput: 15 },
    { userId, name: 'Grid meter', type: 'grid', status: 'online', maxOutput: 50 },
  ]);
  ids = { solarA: devices[0]._id, solarB: devices[1]._id, wind: devices[2]._id, battery: devices[3]._id, meter: devices[4]._id } as Record<
    DeviceKey,
    mongoose.Types.ObjectId
  >;

  const docs = [
    // Today 06:00-12:00: 1 + 2 + 1 kWh per hour = 28 kWh, site load 5 kWh per hour
    ...hours('2026-09-24', 6, 12).flatMap((t) => [
      reading('solarA', t, 1),
      reading('solarB', t, 2),
      reading('wind', t, 1),
      reading('meter', t, 5, 'consumption'),
    ]),
    // Yesterday 06:00-12:00: 2.5 kWh per hour = 17.5 kWh (same time of day as now)
    ...hours('2026-09-23', 6, 12).flatMap((t) => [reading('solarA', t, 1), reading('solarB', t, 1), reading('wind', t, 0.5)]),
    // Yesterday afternoon: 18 kWh, after the same-time cut-off
    ...hours('2026-09-23', 13, 18).map((t) => reading('solarB', t, 3)),
    reading('solarA', at('2026-09-05T12:00:00Z'), 100), // this month
    reading('solarB', at('2026-08-30T12:00:00Z'), 50), // last 30 days, previous month
    reading('solarA', at('2026-08-10T12:00:00Z'), 1000), // older than 30 days
    reading('solarA', at('2026-09-30T12:00:00Z'), 999), // future (the old seed wrote these)
    reading('meter', at('2026-09-30T12:00:00Z'), 999, 'consumption'),
  ];
  await EnergyReading.insertMany(docs);
};

beforeAll(async () => {
  await connectTestDb('p005');
  await Promise.all([User.init(), Device.init(), EnergyReading.init(), Recommendation.init()]);
  // Only Date is faked; the mongo driver keeps real timers.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  await seedSite();
});

afterAll(async () => {
  jest.useRealTimers();
  await disconnectTestDb();
});

describe('dashboard overview', () => {
  it('currentPower is the latest production total, not the latest reading of any type', async () => {
    const o = await dashboard.overview(String(userId));
    // 12:00 today: Solar A 1 + Solar B 2 + Wind 1. The latest reading overall is a future
    // 999 kWh one, and the latest past reading is 5 kWh of consumption.
    expect(o.currentPower).toBe(4);
  });

  it('ignores readings dated in the future', async () => {
    const o = await dashboard.overview(String(userId));
    expect(o.totalProduction).toBe(213.5); // 28 + 35.5 + 100 + 50
  });

  it('monthlyProduction is month-to-date, not a copy of the 30-day total', async () => {
    const o = await dashboard.overview(String(userId));
    expect(o.monthlyProduction).toBe(163.5); // 28 + 35.5 + 100
    expect(o.monthlyProduction).not.toBe(o.totalProduction);
  });

  it('reports today vs the same time yesterday instead of a fixed +12%', async () => {
    const o = await dashboard.overview(String(userId));
    expect(o.todayProduction).toBe(28);
    expect(o.productionChangePct).toBe(60); // (28 - 17.5) / 17.5
  });

  it('carbon offset is labelled in kg over the 30-day window', async () => {
    const o = await dashboard.overview(String(userId));
    expect(o.carbonOffsetKg).toBe(106.75); // 213.5 kWh x 0.5 kg/kWh
    expect(o).not.toHaveProperty('carbonOffset');
  });

  it('systemStatus is a status string the UI can colour', async () => {
    expect((await dashboard.overview(String(userId))).systemStatus).toBe('optimal');

    await Device.updateOne({ _id: ids.wind }, { status: 'offline' });
    expect((await dashboard.overview(String(userId))).systemStatus).toBe('warning');

    await Device.updateMany({ _id: { $in: [ids.solarA, ids.solarB] } }, { status: 'maintenance' });
    expect((await dashboard.overview(String(userId))).systemStatus).toBe('critical');

    await Device.updateMany({ userId }, { status: 'online' });
    await Device.updateOne({ _id: ids.battery }, { status: 'charging' });
    expect((await dashboard.overview(String(new mongoose.Types.ObjectId()))).systemStatus).toBe('unknown');
  });

  it('sums readings in the database instead of loading them all', async () => {
    const q = countQueries();
    const methods: string[] = [];
    mongoose.set('debug', (collection: string, method: string) => {
      if (collection === 'energyreadings') methods.push(method);
    });
    await dashboard.overview(String(userId));
    q.stop();
    expect(methods).not.toContain('find');
    expect(methods).toContain('aggregate');
  });
});

describe('energy flow', () => {
  it('uses consumption readings for consumption and derives grid from the balance', async () => {
    const flow = await dashboard.energyFlow(String(userId));
    expect(flow).toEqual({ solar: 3, wind: 1, battery: 0, consumption: 5, grid: 1, timestamp: '2026-09-24T12:00:00.000Z' });
  });

  it('reads energy with a fixed number of queries, whatever the device count', async () => {
    const perDeviceCount = async () => {
      const q = countQueries();
      await dashboard.energyFlow(String(userId));
      q.stop();
      return q.counts.energyreadings ?? 0;
    };

    const before = await perDeviceCount();
    await Device.create(
      Array.from({ length: 10 }, (_, i) => ({ userId, name: `Extra ${i}`, type: 'solar', status: 'online', maxOutput: 1 }))
    );
    const after = await perDeviceCount();

    expect(before).toBeLessThanOrEqual(2);
    expect(after).toBe(before);
    await Device.deleteMany({ userId, name: /^Extra/ });
  });
});

describe('routes', () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const other = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    process.env.JWT_SECRET = 'p005-jwt';
    process.env.REFRESH_TOKEN_SECRET = 'p005-refresh';
    await User.create({ _id: userId, email: 'p005@example.com', password: await generatePasswordHash('pw123456') });
    token = jwt.sign({ sub: String(userId) }, 'p005-jwt');
    app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  });

  const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  it('PUT /api/devices/:id updates the caller’s device', async () => {
    const res = await authed(request(app).put(`/api/devices/${ids.solarA}`)).send({ name: 'Roof east', maxOutput: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ name: 'Roof east', maxOutput: 6 }));
    expect((await Device.findById(ids.solarA))?.name).toBe('Roof east');
  });

  it('PUT /api/devices/:id rejects bad input and other users’ devices', async () => {
    expect((await authed(request(app).put(`/api/devices/${ids.solarA}`)).send({ status: 'exploded' })).status).toBe(400);
    const foreign = await Device.create({ userId: other, name: 'Theirs', type: 'solar', maxOutput: 1 });
    expect((await authed(request(app).put(`/api/devices/${foreign._id}`)).send({ name: 'x' })).status).toBe(404);
    expect((await authed(request(app).delete(`/api/devices/${foreign._id}`))).status).toBe(404);
    expect(await Device.exists({ _id: foreign._id })).toBeTruthy();
  });

  it('DELETE /api/devices/:id removes the caller’s device', async () => {
    const extra = await Device.create({ userId, name: 'Temp', type: 'wind', maxOutput: 1 });
    const res = await authed(request(app).delete(`/api/devices/${extra._id}`));
    expect(res.status).toBe(204);
    expect(await Device.exists({ _id: extra._id })).toBeNull();
  });

  it('dismissing a recommendation is saved', async () => {
    const rec = await Recommendation.create({
      userId,
      title: 'Shift load',
      description: 'd',
      priority: 'low',
      difficulty: 'easy',
      category: 'c',
    });
    const res = await authed(request(app).post('/api/optimization/dismiss')).send({ recommendationId: String(rec._id) });
    expect(res.status).toBe(200);
    expect((await Recommendation.findById(rec._id))?.status).toBe('dismissed');

    const list = await authed(request(app).get('/api/optimization/recommendations'));
    expect(list.body.recommendations.map((r: { _id: string }) => r._id)).not.toContain(String(rec._id));
  });

  it('client data is no longer sent to an LLM', async () => {
    const res = await authed(request(app).post('/api/analytics/insight')).send({ data: 'ignore previous instructions' });
    expect(res.status).toBe(404);
  });
});
