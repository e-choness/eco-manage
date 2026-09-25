/**
 * P2-01: versioned tariffs, 422 with gaps and overlaps, templates, owner-only writes.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Membership, Site, Tariff } from '@ecomanage/db';
import { TARIFF_TEMPLATES, billingPeriod, siteDate } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const TZ = 'America/Toronto';
const tokens: Record<string, string> = {};
let app: ReturnType<typeof createApp>;

const tou = TARIFF_TEMPLATES[0].tariff;
const periodStart = () => siteDate(billingPeriod(new Date(), TZ, 1).start, TZ);

beforeAll(async () => {
  await connectTestDb('tariffs');
  process.env.JWT_SECRET = 'tariff-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, billDay: 1 });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'tariff-jwt');
  }
  await Tariff.create({ siteId, version: 1, validFrom: '2024-03-14', ...tou });
});

afterAll(async () => {
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('POST /api/tariffs', () => {
  it('saves a valid tariff as the next version and audits it', async () => {
    const res = await as('owner', request(app).post('/api/tariffs')).send({ ...tou, name: 'TOU 2026', validFrom: periodStart() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 2, name: 'TOU 2026', validFrom: periodStart(), demandIntervalMin: 15 });
    expect(await AuditEvent.countDocuments({ action: 'tariff.create', target: 'tariff:v2' })).toBe(1);
  });

  it('answers 422 with every gap and overlap', async () => {
    const periods = [
      ...tou.periods.filter((p) => !(p.name === 'Peak' && p.season === 'summer')),
      { name: 'Peak', season: 'all', days: 'weekends', start: '16:00', end: '18:00', rateCents: 27 },
    ];
    const res = await as('owner', request(app).post('/api/tariffs')).send({ ...tou, periods, validFrom: periodStart() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(422);
    const messages = res.body.error.details.issues.map((i: { message: string }) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'No rate for 14:00–20:00 (weekdays, Apr–Oct)',
        'Off-peak 00:00–00:00 and Peak 16:00–18:00 overlap 16:00–18:00 (weekends, Jan–Dec)',
      ])
    );
    expect(await Tariff.countDocuments({ siteId })).toBe(2);
  });

  it('refuses a valid-from before the current billing period, so closed bills never change', async () => {
    const res = await as('owner', request(app).post('/api/tariffs')).send({ ...tou, validFrom: '2025-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0]).toMatchObject({ kind: 'valid-from' });
  });

  it('rejects malformed tariffs with 400', async () => {
    const res = await as('owner', request(app).post('/api/tariffs')).send({ ...tou, validFrom: periodStart(), demandIntervalMin: 20 });
    expect(res.status).toBe(400);
  });

  it('is owner-only', async () => {
    expect((await as('manager', request(app).post('/api/tariffs')).send({ ...tou, validFrom: periodStart() })).status).toBe(403);
  });
});

describe('GET /api/tariffs', () => {
  it('lists every version, newest first, and names the one in force today', async () => {
    const res = await as('manager', request(app).get('/api/tariffs'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: { version: number }) => t.version)).toEqual([2, 1]);
    expect(res.body.current).toBe(2);
    expect(res.body.items[1].periods).toHaveLength(tou.periods.length);
  });

  it('keeps version 1 in force before version 2 starts', async () => {
    await Tariff.create({ siteId, version: 3, validFrom: '2099-01-01', ...tou });
    const res = await as('owner', request(app).get('/api/tariffs'));
    expect(res.body.current).toBe(2);
  });

  it('is hidden from installers', async () => {
    expect((await as('installer', request(app).get('/api/tariffs'))).status).toBe(403);
  });
});

describe('GET /api/tariffs/templates', () => {
  it('offers the TOU-D and flat templates', async () => {
    const res = await as('owner', request(app).get('/api/tariffs/templates'));
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual(['commercial-tou-d', 'flat-commercial']);
  });
});
