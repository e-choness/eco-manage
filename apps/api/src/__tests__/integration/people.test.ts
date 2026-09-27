/**
 * P4-08: Settings → People and Rules. Members with access until a local date, the last owner kept,
 * pending invites revoked; rules toggled and tuned within their settings, approval settings, and
 * decline counts per rule.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Invite, Membership, Recommendation, RuleConfig, Site } from '@ecomanage/db';
import type { MemberView, PeopleResponse, RulesResponse } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { JobClient } from '../../lib/jobs';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const jobs = { sendInvite: async () => undefined } as unknown as JobClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('people');
  process.env.JWT_SECRET = 'people-jwt';
  app = createApp({ env, jobs });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  const password = await generatePasswordHash('pw123456');
  for (const [role, name] of [['owner', 'Priya Shah'], ['manager', 'Jamie Reyes'], ['installer', 'Northside Solar']] as const) {
    const u = await User.create({ email: `${role}@example.com`, name, password });
    ids[role] = String((await Membership.create({ userId: u._id, siteId, role }))._id);
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'people-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([AuditEvent.deleteMany({}), Invite.deleteMany({}), RuleConfig.deleteMany({}), Recommendation.deleteMany({})]);
  await Membership.updateMany({ siteId }, { $set: { until: null } });
  await Membership.updateOne({ _id: ids.manager }, { $set: { role: 'manager' } });
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const people = async () => (await as('owner', request(app).get('/api/site/members'))).body as PeopleResponse;

describe('/api/site/members', () => {
  it('lists people with their role, and pending invites', async () => {
    await as('owner', request(app).post('/api/site/invites')).send({ email: 'sam@example.com', role: 'installer', until: '2099-12-31' });
    const p = await people();
    expect(p.members.map((m: MemberView) => [m.name, m.role, m.until, m.you])).toEqual([
      ['Priya Shah', 'owner', null, true],
      ['Jamie Reyes', 'manager', null, false],
      ['Northside Solar', 'installer', null, false],
    ]);
    expect(p.invites).toMatchObject([{ email: 'sam@example.com', role: 'installer', until: '2099-12-31', invitedBy: 'Priya Shah' }]);
  });

  it('keeps access to the end of the chosen local day, and changes roles', async () => {
    const res = await as('owner', request(app).patch(`/api/site/members/${ids.installer}`)).send({ until: '2099-06-30' });
    expect(res.body).toMatchObject({ role: 'installer', until: '2099-06-30' });
    expect((await Membership.findById(ids.installer).lean())!.until).toEqual(new Date('2099-07-01T04:00:00Z'));
    expect((await as('owner', request(app).patch(`/api/site/members/${ids.manager}`)).send({ role: 'owner' })).body.role).toBe('owner');
    expect(await AuditEvent.countDocuments({ action: 'membership.update' })).toBe(2);
    expect((await as('owner', request(app).patch(`/api/site/members/${ids.installer}`)).send({ until: '2020-01-01' })).status).toBe(400);
  });

  it('keeps at least one owner with lasting access', async () => {
    const demote = await as('owner', request(app).patch(`/api/site/members/${ids.owner}`)).send({ role: 'manager' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.message).toBe('A site needs at least one owner with lasting access');
    expect((await as('owner', request(app).patch(`/api/site/members/${ids.owner}`)).send({ until: '2099-01-01' })).status).toBe(409);
    expect((await as('owner', request(app).delete(`/api/site/members/${ids.owner}`))).status).toBe(409);
  });

  it('removes a person and revokes an invite', async () => {
    const extra = await User.create({ email: 'temp@example.com', name: 'Temp', password: await generatePasswordHash('pw123456') });
    const m = await Membership.create({ userId: extra._id, siteId, role: 'manager' });
    expect((await as('owner', request(app).delete(`/api/site/members/${m._id}`))).status).toBe(204);
    expect(await Membership.exists({ _id: m._id })).toBeNull();
    expect(await AuditEvent.countDocuments({ action: 'membership.delete', target: `membership:${m._id}` })).toBe(1);
    const inv = (await as('owner', request(app).post('/api/site/invites')).send({ email: 'sam@example.com', role: 'manager' })).body;
    expect((await as('owner', request(app).delete(`/api/site/invites/${inv.id}`))).status).toBe(204);
    expect((await people()).invites).toEqual([]);
    expect(await AuditEvent.countDocuments({ action: 'invite.revoke' })).toBe(1);
    expect((await as('owner', request(app).delete(`/api/site/invites/${inv.id}`))).status).toBe(404);
  });
});

describe('/api/rules', () => {
  it('shows each rule with its defaults, saved values and decline reasons', async () => {
    await Recommendation.create(
      [1, 2, 3].map((i) => ({
        siteId,
        ruleId: 'peak-shaving',
        dedupeKey: `k${i}`,
        deviceId: 'bat',
        action: 'force_discharge',
        title: 't',
        window: { start: new Date(), end: new Date(Date.now() + 3_600_000) },
        status: 'declined',
        declineReason: i < 3 ? 'Bad timing for the building' : 'Data looks wrong',
        decidedAt: new Date(),
        proposedAt: new Date(),
        expiresAt: new Date(),
      }))
    );
    const r = (await as('installer', request(app).get('/api/rules'))).body as RulesResponse;
    expect(r.approval).toEqual({ who: 'owner-or-manager', expireMin: 15, email: 'approvers' });
    const peak = r.rules.find((x) => x.id === 'peak-shaving')!;
    expect(peak).toMatchObject({ title: 'Peak shaving', on: true, params: { maxKw: 60, marginKw: 10 }, defaults: { on: true } });
    expect(peak.declines30d).toEqual({ count: 3, reasons: [{ reason: 'Bad timing for the building', count: 2 }, { reason: 'Data looks wrong', count: 1 }] });
    expect(r.rules.map((x) => x.id)).toHaveLength(6);
  });

  it('turns a rule off and tunes it, within its own settings', async () => {
    const res = await as('manager', request(app).patch('/api/rules/peak-shaving')).send({ on: false, params: { marginKw: 15 } });
    expect(res.status).toBe(200);
    expect(res.body.rules.find((x: { id: string }) => x.id === 'peak-shaving')).toMatchObject({ on: false, params: { marginKw: 15, maxKw: 60 } });
    expect(await AuditEvent.countDocuments({ action: 'rule.update', target: 'rule:peak-shaving' })).toBe(1);
    expect((await as('manager', request(app).patch('/api/rules/peak-shaving')).send({ params: { nonsense: 1 } })).status).toBe(400);
    expect((await as('manager', request(app).patch('/api/rules/ev-offpeak')).send({ params: { fleetOnly: 3 } })).status).toBe(400);
    expect((await as('manager', request(app).patch('/api/rules/peak-shaving')).send({ params: { maxKw: -5 } })).status).toBe(400);
    expect((await as('manager', request(app).patch('/api/rules/not-a-rule')).send({ on: true })).status).toBe(404);
    expect((await as('installer', request(app).patch('/api/rules/peak-shaving')).send({ on: true })).status).toBe(403);
  });

  it('saves who approves', async () => {
    const res = await as('owner', request(app).patch('/api/rules/approval')).send({ params: { who: 'owner', expireMin: 30 } });
    expect(res.body.approval).toEqual({ who: 'owner', expireMin: 30, email: 'approvers' });
    expect((await as('owner', request(app).patch('/api/rules/approval')).send({ params: { who: 'anyone' } })).status).toBe(400);
  });
});
