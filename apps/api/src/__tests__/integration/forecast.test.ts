/**
 * P2-10: GET /api/forecast, and the forecast reruns a calendar or solar-array change asks for.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { Device, Forecast, Membership, Site } from '@ecomanage/db';
import { DEMO_CALENDAR_INPUT } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { JobClient } from '../../lib/jobs';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const inverter = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const reruns: string[] = [];
const jobs = { requestForecast: async (id: string) => void reruns.push(id) } as unknown as JobClient;
let app: ReturnType<typeof createApp>;

const STEP = 15 * 60_000;
const step0 = Math.floor(Date.now() / STEP) * STEP;
const at = (i: number) => new Date(step0 + i * STEP);

beforeAll(async () => {
  await connectTestDb('forecast');
  process.env.JWT_SECRET = 'forecast-jwt';
  app = createApp({ env, jobs });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', lat: 43.65, lon: -79.38 });
  await Device.create({ _id: inverter, siteId, type: 'pv', name: 'Inverter A', ratedKw: 50, status: 'live' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'forecast-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('GET /api/forecast', () => {
  it('is empty before the worker has issued anything', async () => {
    const res = await as('installer', request(app).get('/api/forecast'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ issuedAt: { pv: null, load: null }, source: null, points: [], profiles: [], accuracy: { pv: null, load: null } });
  });

  it('merges the latest PV and load forecasts from the current step, with net load and weather', async () => {
    const issued = at(-4);
    const old = at(-8);
    await Forecast.create([
      { siteId, kind: 'pv', issuedAt: old, source: 'simulated', points: [{ ts: at(0), kw: 99 }] },
      {
        siteId,
        kind: 'pv',
        issuedAt: issued,
        source: 'simulated',
        points: [-1, 0, 1].map((i) => ({ ts: at(i), kw: 30 + i })),
        weather: [0, 1].map((i) => ({ ts: at(i), tempC: 24.04, cloud: 0.912 })),
      },
      {
        siteId,
        kind: 'load',
        issuedAt: issued,
        source: 'simulated',
        points: [0, 1, 2].map((i) => ({ ts: at(i), kw: 80 })),
        profiles: [{ date: '2026-09-24', label: 'Thursday open-day profile', days: 6 }],
      },
      { siteId, kind: 'load', issuedAt: at(-100), source: 'simulated', points: [], accuracy: { mape: 8.4, n: 90, evaluatedAt: at(-4) } },
    ]);
    const res = await as('manager', request(app).get('/api/forecast'));
    expect(res.body.issuedAt).toEqual({ pv: issued.toISOString(), load: issued.toISOString() });
    expect(res.body.points).toEqual([
      { ts: at(0).toISOString(), pvKw: 30, loadKw: 80, netKw: 50, tempC: 24, cloud: 0.91, storm: false },
      { ts: at(1).toISOString(), pvKw: 31, loadKw: 80, netKw: 49, tempC: 24, cloud: 0.91, storm: false },
      { ts: at(2).toISOString(), pvKw: null, loadKw: 80, netKw: null, tempC: null, cloud: null, storm: null },
    ]);
    expect(res.body.profiles).toEqual([{ date: '2026-09-24', label: 'Thursday open-day profile', days: 6 }]);
    expect(res.body.accuracy).toEqual({ pv: null, load: { mape: 8.4, n: 90, issuedAt: at(-100).toISOString() } });
  });
});

describe('forecast reruns', () => {
  it('are requested when the calendar or the solar arrays change', async () => {
    reruns.length = 0;
    expect((await as('manager', request(app).put('/api/calendar')).send(DEMO_CALENDAR_INPUT)).status).toBe(200);
    const arrays = [{ name: 'Roof', inverterId: String(inverter), kwp: 48, tiltDeg: 10, azimuthDeg: 180 }];
    expect((await as('installer', request(app).put('/api/site/pv-arrays')).send(arrays)).status).toBe(200);
    expect(reruns).toEqual([String(siteId), String(siteId)]);
  });

  it('never fail the change itself', async () => {
    const failing = createApp({ env, jobs: { requestForecast: async () => Promise.reject(new Error('redis down')) } as unknown as JobClient });
    expect((await as('owner', request(failing).put('/api/calendar')).send(DEMO_CALENDAR_INPUT)).status).toBe(200);
  });
});
