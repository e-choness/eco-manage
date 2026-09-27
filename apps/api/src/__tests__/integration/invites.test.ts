/**
 * P4-02: invites. Owners invite by email; the link from the email creates the account (or signs
 * in an existing one), adds the membership and starts a session. Links are single use and expire.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Invite, Membership, Site } from '@ecomanage/db';
import type { InviteJob } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { JobClient } from '../../lib/jobs';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const sent: InviteJob[] = [];
let failSend = false;
const jobs = {
  sendInvite: async (job: InviteJob) => {
    if (failSend) throw new Error('redis down');
    sent.push(job);
  },
} as unknown as JobClient;
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('invites');
  process.env.JWT_SECRET = 'invite-jwt';
  process.env.REFRESH_TOKEN_SECRET = 'invite-refresh';
  app = createApp({ env, jobs });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['owner', 'Priya Shah'], ['manager', 'Jamie Reyes']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'invite-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  sent.length = 0;
  failSend = false;
  await Promise.all([Invite.deleteMany({}), AuditEvent.deleteMany({}), User.deleteMany({ email: /^new|^other/ })]);
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const invite = async (body: object) => as('owner', request(app).post('/api/site/invites')).send(body);

describe('POST /api/site/invites', () => {
  it('stores only a hash of the token, emails the link, and audits', async () => {
    const res = await invite({ email: ' New.Installer@Example.com ', role: 'installer', until: '2099-01-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'new.installer@example.com', role: 'installer', until: '2099-01-01', invitedBy: 'Priya Shah' });
    expect((await Invite.findById(res.body.id).lean())!.until).toEqual(new Date('2099-01-02T05:00:00Z')); // end of the local day
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(res.body).not.toHaveProperty('token');
    expect(sent).toHaveLength(1);
    const stored = await Invite.findById(res.body.id).lean();
    expect(stored!.tokenHash).toHaveLength(64);
    expect(stored!.tokenHash).not.toContain(sent[0].token);
    expect(await AuditEvent.countDocuments({ action: 'invite.create', target: `invite:${res.body.id}` })).toBe(1);
  });

  it('replaces an unused invite for the same address, so only the newest link works', async () => {
    await invite({ email: 'new@example.com', role: 'manager' });
    await invite({ email: 'new@example.com', role: 'installer' });
    expect(await Invite.countDocuments({ email: 'new@example.com' })).toBe(1);
    expect((await request(app).get(`/api/invites/${sent[0].token}`)).status).toBe(404);
    expect((await request(app).get(`/api/invites/${sent[1].token}`)).body.role).toBe('installer');
  });

  it('refuses current members, past end dates, bad input, other roles, and a failed email', async () => {
    expect((await invite({ email: 'manager@example.com', role: 'installer' })).status).toBe(409);
    expect((await invite({ email: 'new@example.com', role: 'installer', until: '2020-01-01' })).status).toBe(400);
    expect((await invite({ email: 'not-an-email', role: 'manager' })).status).toBe(400);
    expect((await invite({ email: 'new@example.com', role: 'admin' })).status).toBe(400);
    expect((await as('manager', request(app).post('/api/site/invites')).send({ email: 'new@example.com', role: 'manager' })).status).toBe(403);
    failSend = true;
    expect((await invite({ email: 'new@example.com', role: 'manager' })).status).toBe(503);
    expect(await Invite.countDocuments({})).toBe(0);
    const noRedis = createApp({ env });
    expect((await as('owner', request(noRedis).post('/api/site/invites')).send({ email: 'new@example.com', role: 'manager' })).status).toBe(503);
  });
});

describe('the invite link', () => {
  it('shows the invite, then creates the account, membership and session', async () => {
    await invite({ email: 'new@example.com', role: 'manager' });
    const { token } = sent[0];
    const preview = await request(app).get(`/api/invites/${token}`);
    expect(preview.body).toMatchObject({ siteName: 'Maple Grove School', email: 'new@example.com', role: 'manager', invitedBy: 'Priya Shah', hasAccount: false });

    expect((await request(app).post(`/api/invites/${token}/accept`).send({ password: 'longenough' })).body.error.message).toBe('Enter your name');
    expect((await request(app).post(`/api/invites/${token}/accept`).send({ name: 'Sam', password: 'short' })).body.error.message).toBe('Use at least 8 characters for your password');

    const res = await request(app).post(`/api/invites/${token}/accept`).send({ name: 'Sam Lee', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'new@example.com', name: 'Sam Lee' });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('password');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^em_rt=.+HttpOnly/);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body.memberships).toEqual([{ siteId: String(siteId), siteName: 'Maple Grove School', role: 'manager', until: null }]);
    expect(await AuditEvent.countDocuments({ action: 'invite.accept', userId: res.body._id })).toBe(1);

    // Single use
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(410);
    expect((await request(app).post(`/api/invites/${token}/accept`).send({ name: 'Sam Lee', password: 'longenough' })).status).toBe(410);
  });

  it('signs in an existing account with its own password and adds the site', async () => {
    const password = await generatePasswordHash('existing-pw');
    await User.create({ email: 'other@example.com', name: 'Northside Solar', password });
    await invite({ email: 'other@example.com', role: 'installer', until: '2099-06-30' });
    const { token } = sent[0];
    expect((await request(app).get(`/api/invites/${token}`)).body.hasAccount).toBe(true);
    const wrong = await request(app).post(`/api/invites/${token}/accept`).send({ password: 'guess' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe('Password is incorrect for this account');
    const res = await request(app).post(`/api/invites/${token}/accept`).send({ password: 'existing-pw', name: 'Ignored' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Northside Solar');
    const m = await Membership.findOne({ siteId, userId: res.body._id }).lean();
    expect(m).toMatchObject({ role: 'installer', until: new Date('2099-07-01T04:00:00Z') });
  });

  it('refuses unknown and expired links', async () => {
    expect((await request(app).get('/api/invites/not-a-real-token')).status).toBe(404);
    await invite({ email: 'new@example.com', role: 'manager' });
    await Invite.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post(`/api/invites/${sent[0].token}/accept`).send({ name: 'Sam', password: 'longenough' });
    expect(res.status).toBe(410);
    expect(res.body.error.message).toMatch(/expired/);
    expect(await User.exists({ email: 'new@example.com' })).toBeNull();
  });
});
