/**
 * P2-05: bills API. The worker is replaced by an in-process job client, so these tests cover the
 * API's side: reading bills, pricing custom ranges, caching statements, taking utility bills.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Bill, Interval15, Membership, Site, Tariff, fileInfo, putFile } from '@ecomanage/db';
import { TARIFF_TEMPLATES, type DocumentJobs } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import { JobTimeout, type JobClient } from '../../lib/jobs';
import { projectedCents } from '../../modules/bills/service';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const TZ = 'America/Toronto';
const tokens: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const COMPUTED = new Date('2026-09-02T06:00:00Z');

// Stand-in for the worker: records queued jobs, renders a fake statement on `run`.
const jobs = {
  added: [] as { name: string; data: unknown }[],
  runs: 0,
  timeout: false,
  async add(name: string, data: unknown) {
    this.added.push({ name, data });
  },
  async run(_name: string, data: DocumentJobs['statement']['data']) {
    this.runs++;
    if (this.timeout) throw new JobTimeout('slow');
    const fileId = await putFile(`statement-${data.period}.pdf`, Buffer.from('%PDF-1.4 fake statement'), { siteId: data.siteId, kind: 'statement', contentType: 'application/pdf' });
    await Bill.updateOne({ siteId, period: data.period }, { $set: { statement: { fileId, renderedAt: new Date() } } });
    return { fileId };
  },
  async close() {},
};

let app: ReturnType<typeof createApp>;
let appNoWorker: ReturnType<typeof createApp>;

const lines = (demandCents: number) => ({ energyPkCents: 50_000, energyMdCents: 30_000, energyOpCents: 20_000, demandCents, fixedCents: 9000, exportCreditCents: 1000 });
const bill = (period: string, start: string, end: string, extra: object) => ({
  siteId,
  period,
  start: new Date(start),
  end: new Date(end),
  inProgress: false,
  energyKwh: { pk: 1850, md: 1875, op: 2222, export: 200 },
  tariffVersion: 1,
  tariffVersions: [1],
  computedAt: COMPUTED,
  ...extra,
});
const iv = (start: string, grid: number, extra: object = {}) => ({ siteId, start: new Date(start), grid, demandKw: grid * 4, ...extra });

beforeAll(async () => {
  await connectTestDb('bills');
  process.env.JWT_SECRET = 'bills-jwt';
  app = createApp({ env, jobs: jobs as unknown as JobClient });
  appNoWorker = createApp({ env });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, billDay: 1 });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'bills-jwt');
  }
  await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-01-01' });
  await Bill.create([
    bill('2026-06', '2026-06-01T04:00:00Z', '2026-07-01T04:00:00Z', { lines: lines(112_000), totalCents: 200_000, peakKw: 80 }),
    bill('2026-07', '2026-07-01T04:00:00Z', '2026-08-01T04:00:00Z', {
      lines: lines(154_000),
      totalCents: 300_000,
      peakKw: 110,
      peakAt: new Date('2026-07-15T19:15:00Z'),
      savedCents: 20_000,
      utility: { status: 'done', totalCents: 297_000, diffCents: 3000, source: 'pdf' },
    }),
    bill('2026-08', '2026-08-01T04:00:00Z', '2026-09-01T04:00:00Z', {
      lines: lines(126_000),
      totalCents: 250_000,
      peakKw: 90,
      savedCents: 15_000,
      estimatedShare: 0.75,
      utility: { status: 'manual', totalCents: 250_000, diffCents: 0, source: 'manual' },
    }),
    bill('2026-09', '2026-09-01T04:00:00Z', '2026-10-01T04:00:00Z', { lines: lines(100_000), totalCents: 50_000, peakKw: 71, inProgress: true }),
  ]);
  // Wed 12 Aug 2026 (EDT): 15:15–16:00 and 16:15 are Peak (27¢); Thu 13 Aug 12:00 is Mid (16¢)
  await Interval15.create([
    iv('2026-08-12T19:15:00Z', 10),
    iv('2026-08-12T19:30:00Z', 12, { quality: 'estimated' }),
    iv('2026-08-12T19:45:00Z', 5, { quality: 'estimated' }),
    iv('2026-08-12T20:15:00Z', 2, { export: 1, quality: 'estimated' }),
    iv('2026-08-13T16:00:00Z', 10),
  ]);
});

afterAll(async () => {
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('GET /api/bills', () => {
  it('lists every period, newest first, with the 12-month KPIs', async () => {
    const res = await as('manager', request(app).get('/api/bills'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { period: string }) => b.period)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
    expect(res.body.items[0]).toMatchObject({ inProgress: true, days: { total: 30 } });
    expect(res.body.items[2]).toMatchObject({ days: { elapsed: 31, total: 31 }, projectedCents: null, utility: { status: 'done', diffCents: 3000 } });
    expect(res.body.kpis).toEqual({
      last12: { totalCents: 750_000, from: '2026-06', to: '2026-08' },
      saved12Cents: 35_000,
      peak12: { kw: 110, period: '2026-07', demandCents: 154_000 },
      utilityDiffPct: 0.5, // (3000 / 297000 + 0) / 2
      compared: 2,
    });
  });

  it('is hidden from installers', async () => {
    expect((await as('installer', request(app).get('/api/bills'))).status).toBe(403);
  });
});

describe('projection of an open period', () => {
  it('scales energy and credit to the whole period and adds demand and fixed once', () => {
    const b = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z'), inProgress: true, lines: lines(100_000) };
    // A third of the way: (100000 − 1000) × 3 + 100000 + 9000
    expect(projectedCents(b as never, new Date('2026-09-11T00:00:00Z'))).toBe(406_000);
    expect(projectedCents({ ...b, inProgress: false } as never, new Date('2026-09-11T00:00:00Z'))).toBeNull();
  });
});

describe('GET /api/bills/:period', () => {
  it('returns the breakdown, tariff, peak and the estimated stretches', async () => {
    const res = await as('owner', request(app).get('/api/bills/2026-08'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: '2026-08',
      totalCents: 250_000,
      gridKwh: 5947,
      tariff: { version: 1, name: 'Commercial TOU-D', demandRateCents: 1400, fixedCents: 9000 },
      savedCents: 15_000,
      estimated: [
        { start: '2026-08-12T19:30:00.000Z', end: '2026-08-12T20:00:00.000Z' },
        { start: '2026-08-12T20:15:00.000Z', end: '2026-08-12T20:30:00.000Z' },
      ],
    });
  });

  it('answers 404 for a period without a bill and 400 for a malformed one', async () => {
    expect((await as('owner', request(app).get('/api/bills/2025-01'))).status).toBe(404);
    expect((await as('owner', request(app).get('/api/bills/2025-13'))).status).toBe(400);
  });
});

describe('GET /api/bills/range', () => {
  it('prices energy for any dates with the tariff of each day, and shows the highest demand', async () => {
    const res = await as('manager', request(app).get('/api/bills/range?from=2026-08-12&to=2026-08-12'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      days: 1,
      energyCents: 783, // (10 + 12 + 5 + 2) kWh × 27¢
      exportCreditCents: 5,
      gridKwh: 29,
      exportKwh: 1,
      peak: { kw: 48, at: '2026-08-12T19:30:00.000Z' },
      tariffVersions: [1],
      intervals: 4,
      estimatedShare: 0.75,
    });
    const two = await as('manager', request(app).get('/api/bills/range?from=2026-08-12&to=2026-08-13'));
    expect(two.body).toMatchObject({ days: 2, energyCents: 943, lines: { energyPkCents: 783, energyMdCents: 160, energyOpCents: 0 } });
  });

  it('rejects reversed, malformed and over-long ranges', async () => {
    for (const q of ['from=2026-08-13&to=2026-08-12', 'from=2026-8-1&to=2026-08-12', 'from=2025-01-01&to=2026-08-12', 'to=2026-08-12'])
      expect((await as('owner', request(app).get(`/api/bills/range?${q}`))).status).toBe(400);
  });
});

describe('GET /api/bills/:period/statement', () => {
  it('has the worker render the PDF once, then serves the stored copy', async () => {
    const first = await as('manager', request(app).get('/api/bills/2026-08/statement'));
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    expect(first.headers['content-disposition']).toBe('attachment; filename="statement-2026-08.pdf"');
    expect(first.body.subarray(0, 5).toString()).toBe('%PDF-');
    const second = await as('manager', request(app).get('/api/bills/2026-08/statement'));
    expect(second.status).toBe(200);
    expect(jobs.runs).toBe(1);
  });

  it('renders again after the bill changes', async () => {
    await Bill.updateOne({ siteId, period: '2026-08' }, { $set: { computedAt: new Date(Date.now() + 1000) } });
    await as('manager', request(app).get('/api/bills/2026-08/statement'));
    expect(jobs.runs).toBe(2);
  });

  it('answers 503 when the worker is slow or missing', async () => {
    jobs.timeout = true;
    try {
      expect((await as('owner', request(app).get('/api/bills/2026-07/statement'))).status).toBe(503);
    } finally {
      jobs.timeout = false;
    }
    expect((await as('owner', request(appNoWorker).get('/api/bills/2026-06/statement'))).status).toBe(503);
  });
});

describe('POST /api/bills/:period/utility-bill', () => {
  it('stores a typed-in total with the difference, and audits it', async () => {
    const res = await as('owner', request(app).post('/api/bills/2026-08/utility-bill')).send({ totalCents: 249_000 });
    expect(res.status).toBe(200);
    expect(res.body.utility).toMatchObject({ status: 'manual', totalCents: 249_000, diffCents: 1000, source: 'manual' });
    expect(await AuditEvent.countDocuments({ action: 'bill.utility.enter', target: 'bill:2026-08' })).toBe(1);
  });

  it('stores an uploaded PDF and queues it for the worker (202)', async () => {
    const res = await as('owner', request(app).post('/api/bills/2026-06/utility-bill')).attach('file', Buffer.from('%PDF-1.4 utility bill'), 'hydro-june.pdf');
    expect(res.status).toBe(202);
    expect(res.body.utility).toMatchObject({ status: 'processing', fileName: 'hydro-june.pdf', totalCents: null });
    const job = jobs.added.at(-1) as { name: string; data: { period: string; fileId: string; siteId: string } };
    expect(job).toMatchObject({ name: 'utility-bill', data: { period: '2026-06', siteId: String(siteId) } });
    expect(await fileInfo(job.data.fileId)).toMatchObject({ metadata: { siteId: String(siteId), kind: 'utility-bill', contentType: 'application/pdf' } });
    expect((await Bill.findOne({ siteId, period: '2026-06' }).lean())!.utility).toMatchObject({ status: 'processing', fileId: job.data.fileId });
    expect(await AuditEvent.countDocuments({ action: 'bill.utility.upload', target: 'bill:2026-06' })).toBe(1);
  });

  it('takes the CSV template', async () => {
    const res = await as('owner', request(app).post('/api/bills/2026-07/utility-bill')).attach('file', Buffer.from('period,total_due\n2026-07,2970.00\n'), 'july.csv');
    expect(res.status).toBe(202);
    expect(jobs.added.at(-1)).toMatchObject({ data: { period: '2026-07' } });
  });

  it('refuses other files, open periods, bad totals and non-owners', async () => {
    const png = await as('owner', request(app).post('/api/bills/2026-07/utility-bill')).attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'bill.png');
    expect(png.status).toBe(415);
    const open = await as('owner', request(app).post('/api/bills/2026-09/utility-bill')).send({ totalCents: 1 });
    expect(open.status).toBe(409);
    expect((await as('owner', request(app).post('/api/bills/2026-07/utility-bill')).send({ totalCents: -5 })).status).toBe(400);
    expect((await as('owner', request(app).post('/api/bills/2026-07/utility-bill')).field('note', 'x')).status).toBe(400);
    expect((await as('manager', request(app).post('/api/bills/2026-07/utility-bill')).send({ totalCents: 1 })).status).toBe(403);
    expect((await as('owner', request(app).post('/api/bills/2025-01/utility-bill')).send({ totalCents: 1 })).status).toBe(404);
  });
});
