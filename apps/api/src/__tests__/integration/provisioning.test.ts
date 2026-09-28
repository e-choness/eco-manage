/**
 * Provisioning: sites and access from a plan (a directory or CRM export). Applying it again changes
 * nothing; people with accounts get the membership, others an invite; prune removes only what
 * provisioning granted; a site always keeps an owner; everything is audited as a system change.
 */
import { AuditEvent, Invite, Membership, Site } from '@ecomanage/db';
import { connectTestDb, disconnectTestDb } from './db';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';
import { provisionPlan, type ProvisionPlan } from '../../modules/provisioning/plan';
import { ProvisionError, applyPlan } from '../../modules/provisioning/service';

const now = new Date('2026-09-28T12:00:00Z');
const sent: string[] = [];
const run = (plan: unknown, opts: { dryRun?: boolean; prune?: boolean } = {}) =>
  applyPlan(provisionPlan.parse(plan) as ProvisionPlan, {
    ...opts,
    now,
    deliverInvite: async (inviteId, token) => {
      sent.push(inviteId);
      return `https://demo.example.com/invite/${token}`;
    },
  });

const plan = (members: unknown[], extra: Record<string, unknown> = {}) => ({
  sites: [{ externalId: 'crm-1', name: 'Maple Grove School', tz: 'America/Toronto', members, ...extra }],
});
const owner = { email: 'Owner@Example.com', role: 'owner' };

beforeAll(async () => {
  await connectTestDb('provisioning');
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await Promise.all([Site.deleteMany({}), Membership.deleteMany({}), Invite.deleteMany({}), User.deleteMany({}), AuditEvent.deleteMany({})]);
  sent.length = 0;
});

describe('applyPlan', () => {
  it('creates the site and invites its owner, with a link that works', async () => {
    const changes = await run(plan([owner]));
    expect(changes.map((c) => [c.action, c.detail])).toEqual([
      ['site.create', 'created (time zone America/Toronto)'],
      ['invite.create', 'owner@example.com: invited as owner'],
    ]);
    expect(changes[1].link).toMatch(/^https:\/\/demo\.example\.com\/invite\/[\w-]{43}$/);
    const site = await Site.findOne({ externalId: 'crm-1' }).lean();
    expect(site).toMatchObject({ name: 'Maple Grove School', tz: 'America/Toronto' });
    const invite = await Invite.findOne({ siteId: site!._id }).lean();
    expect(invite).toMatchObject({ email: 'owner@example.com', role: 'owner', until: null, invitedBy: null, source: 'provisioning' });
    expect(sent).toEqual([String(invite!._id)]);
    const audit = await AuditEvent.find({}).sort({ ts: 1 }).lean();
    expect(audit.map((a) => [a.action, a.userId])).toEqual([
      ['site.create', null],
      ['invite.create', null],
    ]);
  });

  it('changes nothing when applied again', async () => {
    await run(plan([owner, { email: 'sam@solar.example', role: 'installer', until: '2026-12-31' }]));
    const again = await run(plan([owner, { email: 'sam@solar.example', role: 'installer', until: '2026-12-31' }]));
    expect(again).toEqual([]);
    expect(await Invite.countDocuments()).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it('gives people who already have an account the membership straight away', async () => {
    const u = await User.create({ email: 'owner@example.com', name: 'Priya Shah', password: await generatePasswordHash('pw123456') });
    const changes = await run(plan([owner]));
    expect(changes.map((c) => c.action)).toEqual(['site.create', 'membership.create']);
    expect(await Membership.findOne({ userId: u._id }).lean()).toMatchObject({ role: 'owner', until: null, source: 'provisioning' });
    expect(await Invite.countDocuments()).toBe(0);
  });

  it('updates roles and end dates, and takes over access given in the app', async () => {
    const u = await User.create({ email: 'jamie@example.com', password: await generatePasswordHash('pw123456') });
    const site = await Site.create({ name: 'Maple Grove School', tz: 'America/Toronto' });
    await Membership.create({ siteId: site._id, userId: u._id, role: 'owner' });
    await Membership.create({ siteId: site._id, userId: (await User.create({ email: 'boss@example.com', password: await generatePasswordHash('pw123456') }))._id, role: 'owner' });

    const changes = await run(plan([{ email: 'jamie@example.com', role: 'manager', until: '2027-06-30' }]));
    // The site made in the app is adopted: its external id is set rather than a second site made.
    expect(changes.map((c) => [c.action, c.detail])).toEqual([
      ['site.update', 'changed externalId'],
      ['membership.update', 'jamie@example.com: manager until 2027-06-30 (now managed by provisioning)'],
    ]);
    expect(await Site.countDocuments()).toBe(1);
    const m = await Membership.findOne({ userId: u._id }).lean();
    expect(m).toMatchObject({ role: 'manager', source: 'provisioning' });
    expect(m!.until!.toISOString()).toBe('2027-07-01T04:00:00.000Z'); // the end of that day in Toronto
  });

  it('prunes only the access provisioning granted', async () => {
    const hash = await generatePasswordHash('pw123456');
    const [a, b, c] = await Promise.all(['a@example.com', 'b@example.com', 'c@example.com'].map((email) => User.create({ email, password: hash })));
    await run(plan([{ email: 'a@example.com', role: 'owner' }, { email: 'b@example.com', role: 'manager' }, { email: 'd@example.com', role: 'installer' }]));
    const site = await Site.findOne({ externalId: 'crm-1' }).lean();
    await Membership.create({ siteId: site!._id, userId: c._id, role: 'manager' }); // given in the app

    const without = plan([{ email: 'a@example.com', role: 'owner' }]);
    expect(await run(without)).toEqual([]); // without --prune nothing is removed
    const changes = await run(without, { prune: true });
    expect(changes.map((x) => [x.action, x.detail])).toEqual([
      ['membership.delete', 'b@example.com: removed'],
      ['invite.revoke', 'd@example.com: invite withdrawn'],
    ]);
    const left = await Membership.find({ siteId: site!._id }).lean();
    expect(left.map((m) => String(m.userId)).sort()).toEqual([String(a._id), String(c._id)].sort());
    expect(left.map((m) => String(m.userId))).not.toContain(String(b._id));
    expect(await Invite.countDocuments()).toBe(0);
  });

  it('never leaves a site without an owner, and changes nothing when a site fails', async () => {
    await expect(run(plan([{ email: 'sam@solar.example', role: 'installer' }]))).rejects.toThrow(ProvisionError);
    await expect(run(plan([{ email: 'x@example.com', role: 'owner', until: '2026-12-31' }]))).rejects.toThrow(/no owner with lasting access/);
    // One bad site in a plan: the good one before it isn't created either.
    const two = { sites: [{ name: 'Good', members: [owner] }, { name: 'Bad', members: [{ email: 'y@example.com', role: 'manager' }] }] };
    await expect(run(two)).rejects.toThrow(/Bad: the site would have no owner/);
    expect(await Site.countDocuments()).toBe(0);

    await run(plan([owner]));
    await expect(run(plan([{ email: 'other@example.com', role: 'manager' }]), { prune: true })).rejects.toThrow(/no owner/);
  });

  it('refuses access that would already have ended', async () => {
    await expect(run(plan([owner, { email: 'sam@solar.example', role: 'installer', until: '2026-01-31' }]))).rejects.toThrow(/already have ended/);
  });

  it('shows the changes without making them on a dry run', async () => {
    const changes = await run(plan([owner]), { dryRun: true });
    expect(changes.map((c) => c.action)).toEqual(['site.create', 'invite.create']);
    expect(changes[1].link).toBeUndefined();
    expect(await Site.countDocuments()).toBe(0);
    expect(await Invite.countDocuments()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('carries the source to the membership when a provisioned invite is accepted', async () => {
    const { acceptInvite } = await import('../../modules/invites/service');
    const [, invite] = await run(plan([owner]));
    const token = invite.link!.split('/').pop()!;
    await acceptInvite(token, { name: 'Priya Shah', password: 'a-long-password' }, now);
    expect(await Membership.findOne({}).lean()).toMatchObject({ role: 'owner', source: 'provisioning' });
  });
});

describe('provisionPlan', () => {
  it('rejects duplicates and unknown fields', () => {
    expect(provisionPlan.safeParse({ sites: [{ name: 'A', members: [owner, owner] }] }).success).toBe(false);
    expect(provisionPlan.safeParse({ sites: [{ name: 'A' }, { name: 'A' }] }).success).toBe(false);
    expect(provisionPlan.safeParse({ sites: [{ name: 'A', externalId: 'x' }, { name: 'A', externalId: 'y' }] }).success).toBe(true);
    expect(provisionPlan.safeParse({ sites: [{ name: 'A', tz: 'Mars/Olympus' }] }).success).toBe(false);
    expect(provisionPlan.safeParse({ sites: [{ name: 'A', password: 'x' }] }).success).toBe(false);
  });
});
