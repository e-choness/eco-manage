/**
 * P4-05: History series and totals from the 15-minute intervals, exports (queued for the worker)
 * and reports (P5-01: queued or scheduled for the reports worker, emailed links).
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { AuditEvent, Export, Interval15, Membership, Report, Site, fileInfo, putFile } from '@ecomanage/db';
import { nextReportRun, type DocumentJobs, type HistoryBucket } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { JobClient } from '../../lib/jobs';
import { logPath } from '../../lib/http';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const queued: { name: string; data: unknown }[] = [];
const jobs = {
  add: async (name: string, data: DocumentJobs['export-csv']['data']) => void queued.push({ name, data }),
  renderReport: async (reportId: string) => void queued.push({ name: 'report', data: { reportId } }),
  scheduleReport: async (reportId: string, schedule: string, tz: string) => void queued.push({ name: 'schedule', data: { reportId, schedule, tz } }),
  unscheduleReport: async (reportId: string) => void queued.push({ name: 'unschedule', data: { reportId } }),
} as unknown as JobClient;
let app: ReturnType<typeof createApp>;

const Q = 15 * 60_000;
// 22–24 Sep 2026 in Toronto (UTC−4): 96 intervals a day.
const DAY0 = Date.parse('2026-09-22T04:00:00Z');
const PEAK_AT = '2026-09-23T18:15:00.000Z';

beforeAll(async () => {
  await connectTestDb('history');
  process.env.JWT_SECRET = 'history-jwt';
  app = createApp({ env, jobs });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD' });
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['owner', 'Priya Shah'], ['manager', 'Jamie Reyes'], ['installer', 'Northside Solar']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'history-jwt');
    users[role] = String(u._id);
  }
  await Interval15.insertMany(
    Array.from({ length: 3 * 96 }, (_, i) => {
      const start = new Date(DAY0 + i * Q);
      return {
        siteId,
        start,
        pv: 0.25,
        used: 0.2,
        batt: i % 2 ? 0.1 : -0.1,
        grid: 0.5,
        export: 0.05,
        bld: 0.3,
        hp: 0.1,
        ev: 0.05,
        demandKw: start.toISOString() === PEAK_AT ? 88 : 40,
        costCents: { pk: 1, md: 2, op: 3 },
        quality: i >= 96 + 8 && i < 96 + 10 ? 'estimated' : 'ok',
      };
    })
  );
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  queued.length = 0;
  await Promise.all([Export.deleteMany({}), Report.deleteMany({}), AuditEvent.deleteMany({})]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const series = async (who: string, qs: string) => (await as(who, request(app).get(`/api/history/series?${qs}`))).body;

describe('GET /api/history/series', () => {
  it('sums each local day, with the day peak, cost and estimated flag', async () => {
    const s = await series('manager', 'from=2026-09-22&to=2026-09-24');
    expect(s).toMatchObject({ from: '2026-09-22', to: '2026-09-24', days: 3, res: 'd', dataStart: '2026-09-22', warnings: [] });
    expect(s.buckets.map((b: HistoryBucket) => [b.start, b.pv, b.grid, b.batt, b.peakKw, b.costCents, b.estimated, b.n])).toEqual([
      ['2026-09-22T04:00:00.000Z', 24, 48, 4.8, 40, 576, false, 96],
      ['2026-09-23T04:00:00.000Z', 24, 48, 4.8, 88, 576, true, 96],
      ['2026-09-24T04:00:00.000Z', 24, 48, 4.8, 40, 576, false, 96],
    ]);
  });

  it('draws hours, quarter hours and empty buckets, and hides money from installers', async () => {
    const h = await series('installer', 'from=2026-09-23&to=2026-09-23&res=h');
    expect(h.buckets).toHaveLength(24);
    expect(h.buckets[0]).toMatchObject({ pv: 1, grid: 2, costCents: null, n: 4 });
    const q = await series('owner', 'from=2026-09-23&to=2026-09-23&res=15m');
    expect(q.buckets).toHaveLength(96);
    expect(q.buckets.find((b: HistoryBucket) => b.start === PEAK_AT).peakKw).toBe(88);
    const wide = await series('owner', 'from=2026-09-20&to=2026-09-25&res=d');
    expect(wide).toMatchObject({ from: '2026-09-22' });
    expect(wide.warnings[0]).toMatch(/^No data before 22 Sep 2026/);
    expect(wide.buckets.at(-1)).toMatchObject({ start: '2026-09-25T04:00:00.000Z', n: 0, pv: 0 });
  });

  it('falls back when the chosen resolution would draw more than 400 bars', async () => {
    const s = await series('owner', 'from=2026-09-22&to=2026-09-26&res=15m');
    expect(s.res).toBe('d');
    expect(s.warnings.at(-1)).toMatch(/15-min view would draw 480 bars, so it shows daily/);
    expect((await as('owner', request(app).get('/api/history/series?from=nope&to=2026-09-24'))).status).toBe(400);
  });
});

describe('GET /api/history/totals', () => {
  it('totals a range with its highest demand, and compares with the previous period', async () => {
    const res = await as('owner', request(app).get('/api/history/totals?from=2026-09-23&to=2026-09-24&compare=prev'));
    expect(res.body).toEqual({
      from: '2026-09-23',
      to: '2026-09-24',
      totals: { pvKwh: 48, gridKwh: 96, exportKwh: 9.6, peak: { kw: 88, at: PEAK_AT }, costCents: 1152, estimatedIntervals: 2, intervals: 192 },
      compare: { from: '2026-09-21', to: '2026-09-22', totals: { pvKwh: 24, gridKwh: 48, exportKwh: 4.8, peak: { kw: 40, at: '2026-09-22T04:00:00.000Z' }, costCents: 576, estimatedIntervals: 0, intervals: 96 } },
    });
  });

  it('has nothing to compare with before the first data, and no money for installers', async () => {
    const res = await as('installer', request(app).get('/api/history/totals?from=2026-09-22&to=2026-09-24&compare=yoy'));
    expect(res.body.totals.costCents).toBeNull();
    expect(res.body.compare).toEqual({ from: '2025-09-22', to: '2025-09-24', totals: null });
  });
});

describe('/api/exports', () => {
  it('queues a CSV for the worker, then serves the file it made', async () => {
    const res = await as('installer', request(app).post('/api/exports')).send({ from: '2026-09-22', to: '2026-09-24' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ from: '2026-09-22', to: '2026-09-24', status: 'queued', large: false });
    expect(queued).toEqual([{ name: 'export-csv', data: { exportId: res.body.id } }]);
    expect(await Export.findById(res.body.id).lean()).toMatchObject({ includeCost: false, userId: new mongoose.Types.ObjectId(users.installer) });
    expect(await AuditEvent.countDocuments({ action: 'export.create', target: `export:${res.body.id}` })).toBe(1);
    expect((await as('installer', request(app).get(`/api/exports/${res.body.id}/file`))).status).toBe(409);

    const fileId = await putFile('energy.csv', Buffer.from('local_start\n'), { siteId: String(siteId), kind: 'export', contentType: 'text/csv' });
    await Export.updateOne({ _id: res.body.id }, { $set: { status: 'done', fileId, rows: 0 } });
    expect((await as('owner', request(app).get(`/api/exports/${res.body.id}`))).body).toMatchObject({ status: 'done', rows: 0 });
    const file = await as('owner', request(app).get(`/api/exports/${res.body.id}/file`));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    expect(file.text).toBe('local_start\n');
  });

  it('marks ranges over a year as large (emailed), and needs the worker queue', async () => {
    const res = await as('manager', request(app).post('/api/exports')).send({ from: '2025-01-01', to: '2026-09-24' });
    expect(res.body.large).toBe(true);
    expect(await Export.findById(res.body.id).lean()).toMatchObject({ includeCost: true });
    expect((await as('manager', request(app).post('/api/exports')).send({ from: '2026-09-24', to: '2026-09-01' })).status).toBe(400);
    expect((await as('manager', request(createApp({ env })).post('/api/exports')).send({ from: '2026-09-22', to: '2026-09-24' })).status).toBe(503);
    expect((await as('manager', request(app).get(`/api/exports/${new mongoose.Types.ObjectId()}`))).status).toBe(404);
  });
});

describe('/api/reports', () => {
  const body = { name: 'September energy', from: '2026-09-01', to: '2026-09-30', sections: ['summary', 'cost'], format: 'pdf', schedule: 'monthly', recipients: ['Priya@Example.com'], notes: 'For the board' };

  it('saves a report, lists it newest first, and waits for the reports worker', async () => {
    const res = await as('manager', request(app).post('/api/reports')).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...body, recipients: ['priya@example.com'], status: 'waiting', createdBy: { id: users.manager, name: 'Jamie Reyes' }, canDelete: true });
    expect(await AuditEvent.countDocuments({ action: 'report.create' })).toBe(1);
    const list = (await as('installer', request(app).get('/api/reports'))).body.items;
    expect(list.map((r: { name: string; canDelete: boolean }) => [r.name, r.canDelete])).toEqual([['September energy', false]]);
    const file = await as('manager', request(app).get(`/api/reports/${res.body.id}/file`));
    expect(file.status).toBe(409);
    expect(file.body.error.message).toBe('This report hasn’t been generated yet');
    // A monthly report gets a job scheduler in the site's zone and runs next on the 1st at 07:00.
    expect(queued).toEqual([{ name: 'schedule', data: { reportId: res.body.id, schedule: 'monthly', tz: 'America/Toronto' } }]);
    expect(res.body).toMatchObject({ error: null, lastRunAt: null, lastRange: null });
    expect(res.body.nextRunAt).toBe(nextReportRun('monthly', 'America/Toronto', new Date()).toISOString());
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(res.body.nextRunAt))).toBe('01, 07:00');
  });

  it('renders a one-off report straight away, and says why one failed', async () => {
    const res = await as('owner', request(app).post('/api/reports')).send({ ...body, schedule: 'once', recipients: [] });
    expect(queued).toEqual([{ name: 'report', data: { reportId: res.body.id } }]);
    expect(res.body.nextRunAt).toBeNull();
    await Report.updateOne({ _id: res.body.id }, { $set: { status: 'failed', error: 'PDF rendering failed (503)' } });
    const file = await as('owner', request(app).get(`/api/reports/${res.body.id}/file`));
    expect(file.status).toBe(409);
    expect(file.body.error.message).toBe('This report failed to render: PDF rendering failed (503)');
  });

  it('keeps cost out of installer reports and asks scheduled reports for a recipient', async () => {
    expect((await as('installer', request(app).post('/api/reports')).send(body)).status).toBe(403);
    expect((await as('installer', request(app).post('/api/reports')).send({ ...body, sections: ['summary'] })).status).toBe(201);
    const noOne = await as('owner', request(app).post('/api/reports')).send({ ...body, recipients: [] });
    expect(noOne.status).toBe(400);
    expect(noOne.body.error.message).toBe('A scheduled report needs at least one recipient');
    expect((await as('owner', request(app).post('/api/reports')).send({ ...body, schedule: 'once', recipients: [], sections: [] })).status).toBe(400);
  });

  it('can be removed by its creator or the owner only', async () => {
    const id = (await as('manager', request(app).post('/api/reports')).send(body)).body.id;
    expect((await as('installer', request(app).delete(`/api/reports/${id}`))).status).toBe(403);
    expect((await as('owner', request(app).delete(`/api/reports/${id}`))).status).toBe(204);
    expect(await AuditEvent.countDocuments({ action: 'report.delete', target: `report:${id}` })).toBe(1);
    expect(queued.at(-1)).toEqual({ name: 'unschedule', data: { reportId: id } });
    expect((await as('owner', request(app).delete(`/api/reports/${id}`))).status).toBe(404);
  });
});

describe('/api/report-links (emailed, no sign-in)', () => {
  const token = 'a'.repeat(43);
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const withRun = async (linkExpiresAt: Date) => {
    const fileId = await putFile('september-energy-2026-09-01-to-2026-09-30.csv', Buffer.from('# Energy summary\n'), { siteId: String(siteId), kind: 'report', contentType: 'text/csv' });
    return Report.create({
      siteId,
      createdBy: users.owner,
      name: 'September energy',
      from: '2026-09-01',
      to: '2026-09-30',
      sections: ['summary'],
      format: 'csv',
      schedule: 'monthly',
      recipients: ['board@example.com'],
      status: 'ready',
      fileId,
      lastRunAt: new Date(),
      files: [{ runAt: new Date(), from: '2026-09-01', to: '2026-09-30', status: 'ready', fileId, tokenHash: hash(token), linkExpiresAt }],
    });
  };

  it('downloads the run’s file while the link lasts', async () => {
    const r = await withRun(new Date(Date.now() + 86_400_000));
    const res = await request(app).get(`/api/report-links/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="september-energy-2026-09-01-to-2026-09-30.csv"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).toBe('# Energy summary\n');
    const view = (await as('owner', request(app).get('/api/reports'))).body.items[0];
    expect(view).toMatchObject({ status: 'ready', lastRange: { from: '2026-09-01', to: '2026-09-30' } });

    // Removing the report removes its files, and the link stops working.
    await as('owner', request(app).delete(`/api/reports/${r._id}`));
    expect(await fileInfo(r.fileId!)).toBeNull();
    expect((await request(app).get(`/api/report-links/${token}`)).status).toBe(404);
  });

  it('refuses expired, unknown and malformed links', async () => {
    await withRun(new Date(Date.now() - 1000));
    const expired = await request(app).get(`/api/report-links/${token}`);
    expect(expired.status).toBe(410);
    expect(expired.body.error.message).toBe('This link has expired. Ask the site for a new copy of the report.');
    expect((await request(app).get(`/api/report-links/${'b'.repeat(43)}`)).status).toBe(404);
    expect((await request(app).get('/api/report-links/short')).status).toBe(404);
  });

  it('keeps link tokens out of request logs', () => {
    expect(logPath(`/api/report-links/${token}?x=1`)).toBe('/api/report-links/:token');
    expect(logPath('/api/invites/abc/accept')).toBe('/api/invites/:token/accept');
    expect(logPath('/api/reports/123/file?y=2')).toBe('/api/reports/123/file');
  });
});
