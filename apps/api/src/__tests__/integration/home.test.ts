/**
 * P4-03: what Home loads besides the snapshot: the scene model and today's prices and bill line.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Bill, Membership, Site, SiteModel, Tariff } from '@ecomanage/db';
import { DEFAULT_BUILDING, DEFAULT_SITE_MODEL, FLOW_KEYS, TARIFF_TEMPLATES, layoutAround, rectFootprint, type OsmWay, siteDate, siteDateStart, type SiteToday } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';
import { overpassLookup } from '../../modules/site/osm';

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
    const model = { siteId, source: 'generated' as const, hub: [1, 1, 1], anchors: [{ key: 'pv', at: [0, 3, 0], label: [0, 4, 0] }], buildingLabel: [0, 3, 1] };
    await SiteModel.create([
      { ...model, version: 1 },
      { ...model, version: 2, hub: [2, 1, 2], camera: { view: 'iso' as const } },
    ]);
    expect((await as('manager', request(app).get('/api/site/model'))).body).toEqual({
      version: 2,
      source: 'generated',
      upload: null,
      generated: DEFAULT_BUILDING, // saved before P5-03: the demo building
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

  it('saves a generated building with its layout, and keeps it through edits that leave it out (P5-03)', async () => {
    const building = { ...DEFAULT_BUILDING, footprint: rectFootprint(30, 12), storeys: 2, storeyHeightM: 3.5, roofRows: 5 };
    const layout = layoutAround(building, FLOW_KEYS);
    const res = await as('installer', request(app).put('/api/site/model')).send({ ...layout, camera: { view: 'fit' }, generated: building });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 1, source: 'generated', generated: building, hub: layout.hub });
    expect(await AuditEvent.findOne({ action: 'siteModel.update' }).sort({ ts: -1, _id: -1 }).lean()).toMatchObject({ after: { generated: building } });

    // Moving the hub alone keeps the building.
    const moved = await as('owner', request(app).put('/api/site/model')).send({ ...layout, hub: [1, 0.95, 5], camera: { view: 'fit' } });
    expect(moved.body).toMatchObject({ version: 2, hub: [1, 0.95, 5], generated: building });
    expect((await as('manager', request(app).get('/api/site/model'))).body.generated).toEqual(building);
  });

  it('refuses an outline that crosses itself or has too few corners', async () => {
    const body = { hub: [0, 1, 0], anchors: [], buildingLabel: [0, 3, 0], camera: { view: 'fit' } };
    const crossed = await as('owner', request(app).put('/api/site/model')).send({ ...body, generated: { ...DEFAULT_BUILDING, footprint: [[0, 0], [8, 8], [8, 0], [0, 8]] } });
    expect(crossed.status).toBe(400);
    expect(JSON.stringify(crossed.body)).toContain('The outline crosses itself');
    expect((await as('owner', request(app).put('/api/site/model')).send({ ...body, generated: { ...DEFAULT_BUILDING, footprint: [[0, 0], [8, 8]] } })).status).toBe(400);
    expect(await SiteModel.countDocuments()).toBe(0);
  });
});

describe('GET /api/site/model/osm-footprint', () => {
  const at = { lat: 43.65, lon: -79.38 };
  const mLon = 111_320 * Math.cos((at.lat * Math.PI) / 180);
  const ll = (x: number, z: number) => ({ lat: at.lat - z / 110_574, lon: at.lon + x / mLon });
  const school: OsmWay = { type: 'way', id: 42, tags: { building: 'school', name: 'Maple Grove School', 'building:levels': '2' }, geometry: [ll(-20, -8), ll(20, -8), ll(20, 8), ll(-20, 8), ll(-20, -8)] };
  const withOsm = (lookup: (p: { lat: number; lon: number }) => Promise<OsmWay[]>) =>
    createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 }, osm: lookup });

  afterEach(async () => {
    await Site.updateOne({ _id: siteId }, { $set: { lat: null, lon: null } });
  });

  it("finds the building at the site's location, with credit to OpenStreetMap", async () => {
    await Site.updateOne({ _id: siteId }, { $set: at });
    const asked: { lat: number; lon: number }[] = [];
    const res = await as('installer', request(withOsm(async (p) => (asked.push(p), [school]))).get('/api/site/model/osm-footprint'));
    expect(res.status).toBe(200);
    expect(asked).toEqual([at]);
    expect(res.body).toMatchObject({ wayId: 42, name: 'Maple Grove School', storeys: 2, at, attribution: '© OpenStreetMap contributors' });
    expect(res.body.footprint).toHaveLength(4);
  });

  it('searches a given point, and explains why it found nothing', async () => {
    const found = withOsm(async () => [school]);
    expect((await as('owner', request(found).get('/api/site/model/osm-footprint').query(at))).body.wayId).toBe(42);
    // No location on the site and none given.
    expect((await as('owner', request(found).get('/api/site/model/osm-footprint'))).status).toBe(422);
    expect((await as('owner', request(found).get('/api/site/model/osm-footprint').query({ lat: 43 }))).status).toBe(400);
    expect((await as('owner', request(withOsm(async () => [])).get('/api/site/model/osm-footprint').query(at))).status).toBe(404);
    const down = await as('owner', request(withOsm(async () => Promise.reject(new Error('timeout')))).get('/api/site/model/osm-footprint').query(at));
    expect(down.status).toBe(502);
    expect(down.body.error.message).toMatch(/didn’t answer/);
    // Turned off on this server.
    expect((await as('owner', request(app).get('/api/site/model/osm-footprint').query(at))).status).toBe(503);
    expect((await as('manager', request(found).get('/api/site/model/osm-footprint').query(at))).status).toBe(403);
  });

  it('asks Overpass for the building ways around the point, and nothing else', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const lookup = overpassLookup('https://overpass.example/api/interpreter', async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ elements: [school] }) };
    });
    expect(await lookup(at)).toEqual([school]);
    expect(calls[0].url).toBe('https://overpass.example/api/interpreter');
    expect(String(calls[0].init.body)).toBe(new URLSearchParams({ data: `[out:json][timeout:10];way(around:60,${at.lat},${at.lon})["building"];out tags geom;` }).toString());
    const failing = overpassLookup('https://overpass.example/api/interpreter', async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(failing(at)).rejects.toThrow('Overpass answered 429');
  });
});
