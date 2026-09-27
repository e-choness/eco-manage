/**
 * P4-03: what Home loads besides the snapshot: the scene model and today's prices and bill line.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Bill, Membership, Site, SiteModel, Tariff } from '@ecomanage/db';
import { DEFAULT_SITE_MODEL, TARIFF_TEMPLATES, siteDate, siteDateStart, type SiteToday } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const TZ = 'America/Toronto';
const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const DAY = 86_400_000;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('home');
  process.env.JWT_SECRET = 'home-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, currency: 'CAD' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'home-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([SiteModel.deleteMany({}), Tariff.deleteMany({}), Bill.deleteMany({})]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('GET /api/site/model', () => {
  it('is the App v2 demo scene until a model is saved, then the latest version', async () => {
    expect((await as('installer', request(app).get('/api/site/model'))).body).toEqual(DEFAULT_SITE_MODEL);
    const model = { siteId, source: 'generated', hub: [1, 1, 1], anchors: [{ key: 'pv', at: [0, 3, 0], label: [0, 4, 0] }], buildingLabel: [0, 3, 1] };
    await SiteModel.create([
      { ...model, version: 1 },
      { ...model, version: 2, hub: [2, 1, 2], camera: { view: 'iso' } },
    ]);
    expect((await as('manager', request(app).get('/api/site/model'))).body).toEqual({
      version: 2,
      source: 'generated',
      upload: null,
      hub: [2, 1, 2],
      anchors: [{ key: 'pv', at: [0, 3, 0], label: [0, 4, 0] }],
      buildingLabel: [0, 3, 1],
      camera: { view: 'iso' },
    });
  });
});

describe('GET /api/site/today', () => {
  it("gives today's price periods across the whole local day", async () => {
    await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2024-01-01' });
    const res = await as('installer', request(app).get('/api/site/today'));
    const today = res.body as SiteToday;
    expect(today.date).toBe(siteDate(new Date(), TZ));
    expect(today.currency).toBe('CAD');
    const prices = today.prices!;
    expect(prices[0].start).toBe(siteDateStart(today.date, TZ).toISOString());
    expect(Date.parse(prices.at(-1)!.end) - Date.parse(prices[0].start)).toBeGreaterThanOrEqual(23 * 3_600_000);
    for (let i = 1; i < prices.length; i++) expect(prices[i].start).toBe(prices[i - 1].end);
    expect(prices.every((p) => ['off', 'mid', 'peak'].includes(p.level) && p.rateCents > 0)).toBe(true);
  });

  it('has no prices without a tariff, or with a gap today', async () => {
    expect((await as('owner', request(app).get('/api/site/today'))).body.prices).toBeNull();
    await Tariff.create({ ...TARIFF_TEMPLATES[1].tariff, siteId, version: 1, validFrom: '2024-01-01', periods: [{ name: 'Mid', season: 'all', days: 'all', start: '06:00', end: '00:00', rateCents: 15 }] });
    expect((await as('owner', request(app).get('/api/site/today'))).body.prices).toBeNull();
  });

  it('shows the open bill and where it is heading to owners and managers, not installers', async () => {
    const now = Date.now();
    await Bill.create({
      siteId,
      period: '2099-01',
      start: new Date(now - 10 * DAY),
      end: new Date(now + 20 * DAY),
      inProgress: true,
      lines: { energyPkCents: 100_000, energyMdCents: 50_000, energyOpCents: 20_000, demandCents: 150_000, fixedCents: 9000, exportCreditCents: 4000 },
      totalCents: 325_000,
      savedCents: 42_000,
      peakKw: 104,
      energyKwh: { pk: 1, md: 1, op: 1, export: 1 },
      tariffVersion: 1,
      tariffVersions: [1],
      computedAt: new Date(),
    });
    const bill = (await as('manager', request(app).get('/api/site/today'))).body.bill;
    expect(bill).toMatchObject({ period: '2099-01', totalCents: 325_000, savedCents: 42_000 });
    // (energy − export) / (10 of 30 days) + demand + fixed
    expect(bill.projectedCents).toBeGreaterThan(640_000);
    expect(bill.projectedCents).toBeLessThan(660_000);
    expect((await as('installer', request(app).get('/api/site/today'))).body.bill).toBeNull();
  });
});

describe('PUT /api/site/model', () => {
  it('saves the edited model as the next version, for owners and installers', async () => {
    const edited = { ...DEFAULT_SITE_MODEL, hub: [1, 1, 1], anchors: DEFAULT_SITE_MODEL.anchors.slice(0, 2), camera: { view: 'iso' } };
    const body = { hub: edited.hub, anchors: edited.anchors, buildingLabel: edited.buildingLabel, camera: edited.camera };
    const res = await as('installer', request(app).put('/api/site/model')).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 1, source: 'generated', hub: [1, 1, 1], camera: { view: 'iso' } });
    expect(res.body.anchors).toHaveLength(2);
    expect((await as('owner', request(app).put('/api/site/model')).send(body)).body.version).toBe(2);
    expect(await AuditEvent.countDocuments({ action: 'siteModel.update' })).toBe(2);
    expect((await as('manager', request(app).put('/api/site/model')).send(body)).status).toBe(403);
    expect((await as('owner', request(app).put('/api/site/model')).send({ ...body, hub: [0, 0] })).status).toBe(400);
  });
});
