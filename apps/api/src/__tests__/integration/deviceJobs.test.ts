/**
 * P4-04: the installer's scan and commission flow (gateway jobs over MQTT, stubbed here) and the
 * maintenance log.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Device, Maintenance, Membership, Site } from '@ecomanage/db';
import type { JobMessage, JobResultMessage } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { GatewayLink } from '../../lib/gatewayLink';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const SUB = { address: 'RS-485 · id 7', modelCode: 'CT3-100', profileId: 'ct-meter-3ph@2', type: 'submeter', name: 'Sub-meter · kitchen' };

// The gateway answers with whatever the test put next (null: no answer in time).
const jobs: { siteId: string; job: JobMessage }[] = [];
let answer: JobResultMessage | null = null;
const gateway = {
  runJob: async (site: string, _jobId: string, job: JobMessage) => {
    jobs.push({ siteId: site, job });
    return answer;
  },
} as unknown as GatewayLink;
const ok = (data: Record<string, unknown>): JobResultMessage => ({ ok: true, ts: new Date().toISOString(), data });

let app: ReturnType<typeof createApp>;
let meterId = '';

beforeAll(async () => {
  await connectTestDb('device_jobs');
  process.env.JWT_SECRET = 'jobs-jwt';
  app = createApp({ env, gateway });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['installer', 'Northside Solar'], ['manager', 'Jamie Reyes']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'jobs-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  jobs.length = 0;
  answer = null;
  await Promise.all([Device.deleteMany({}), Maintenance.deleteMany({}), AuditEvent.deleteMany({})]);
  meterId = String((await Device.create({ siteId, type: 'meter', name: 'Grid meter', address: 'RS-485 · id 1', status: 'live' }))._id);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('POST /api/devices/scan', () => {
  it("returns what the gateway found that the site doesn't have yet", async () => {
    answer = ok({ found: [SUB, { address: 'RS-485 · id 1', type: 'meter', name: 'Grid meter' }, { nonsense: true }] });
    const res = await as('installer', request(app).post('/api/devices/scan'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: [SUB] });
    expect(jobs).toEqual([{ siteId: String(siteId), job: { type: 'scan', params: {} } }]);
    expect(await AuditEvent.countDocuments({})).toBe(0);
  });

  it('says when the gateway fails, does not answer, or there is no broker', async () => {
    answer = { ok: false, ts: new Date().toISOString(), error: 'RS-485 bus busy', data: {} };
    expect((await as('installer', request(app).post('/api/devices/scan'))).body).toEqual({ error: { code: 502, message: 'RS-485 bus busy' } });
    answer = null;
    const slow = await as('installer', request(app).post('/api/devices/scan'));
    expect(slow.status).toBe(504);
    expect(slow.body.error.message).toMatch(/didn't answer/);
    expect((await as('installer', request(createApp({ env })).post('/api/devices/scan'))).status).toBe(503);
  });
});

describe('POST /api/devices/:id/commission', () => {
  const addSub = async () => (await as('installer', request(app).post('/api/devices')).send({ type: 'submeter', name: SUB.name, profileId: SUB.profileId, address: SUB.address })).body.id as string;
  const checks = [
    { name: 'Live read', pass: true },
    { name: 'Sign check: import positive', pass: true },
    { name: 'Energy balance within 5%', pass: true },
  ];

  it('runs the checks on the gateway and records who commissioned the device', async () => {
    const id = await addSub();
    answer = ok({ checks: [...checks, { junk: 1 }] });
    const res = await as('installer', request(app).post(`/api/devices/${id}/commission`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, checks, error: null, device: { id, status: 'live' } });
    expect(res.body.device.commissionedAt).toEqual(expect.any(String));
    expect(jobs.at(-1)).toEqual({ siteId: String(siteId), job: { type: 'commission', params: { deviceId: id, address: SUB.address } } });
    expect(await AuditEvent.countDocuments({ action: 'device.commission', target: `device:${id}` })).toBe(1);
  });

  it('reports failed checks and leaves the device uncommissioned', async () => {
    const id = await addSub();
    answer = { ok: false, ts: new Date().toISOString(), error: undefined, data: { checks: [checks[0], { name: 'Sign check: import positive', pass: false }] } };
    const res = await as('installer', request(app).post(`/api/devices/${id}/commission`));
    expect(res.body).toMatchObject({ ok: false, error: 'A check failed', checks: [checks[0], { name: 'Sign check: import positive', pass: false }] });
    expect(res.body.device.commissionedAt).toBeNull();
    expect(res.body.device.status).toBe('pending');
    expect(await AuditEvent.countDocuments({ action: 'device.commission' })).toBe(0);
    expect((await as('installer', request(app).post(`/api/devices/${new mongoose.Types.ObjectId()}/commission`))).status).toBe(404);
  });
});

describe('POST /api/devices/:id/maintenance', () => {
  it('adds a visit to the log, newest first on the device, and audits it', async () => {
    const res = await as('installer', request(app).post(`/api/devices/${meterId}/maintenance`)).send({ text: ' CT direction checked ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'visit', text: 'CT direction checked' });
    expect(await Maintenance.countDocuments({ deviceId: meterId, source: 'visit' })).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'maintenance.create', target: `device:${meterId}` })).toBe(1);
    expect((await as('installer', request(app).post(`/api/devices/${meterId}/maintenance`)).send({ text: 'ok' })).status).toBe(400);
    expect((await as('manager', request(app).post(`/api/devices/${meterId}/maintenance`)).send({ text: 'Looked at it' })).status).toBe(403);
  });
});
