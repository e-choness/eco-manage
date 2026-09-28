import mongoose from 'mongoose';
import { Invite, Membership, Site, recordAudit, type InviteDoc, type MembershipDoc, type SiteDoc } from '@ecomanage/db';
import { endOfLocalDate, type Role } from '@ecomanage/shared';
import User from '../auth/model';
import { issueInvite } from '../invites/service';
import type { PlanMember, PlanSite, ProvisionPlan } from './plan';

// Applies a provisioning plan: creates or updates each site, and gives each listed person their
// role. People with an account get the membership straight away; people without one get an invite
// (emailed, or a link to hand over), and choose their own password when they accept it. No password
// ever passes through here, so whatever signs people in later (a directory, single sign-on) only
// has to agree on the email address.
//
// Everything it grants is marked `source: provisioning`. Applying the plan again changes only what
// differs; with `prune`, it also removes provisioned access that is no longer in the plan. Access
// given in the app (Settings → People) is never removed. Every change is audited as a system change.
// A site is never left without an owner with lasting access (or an invite for one).

export interface ProvisionOptions {
  /** Work out the changes without making them. */
  dryRun?: boolean;
  /** Remove provisioned memberships and invites that the plan no longer lists. */
  prune?: boolean;
  /** Delivers a new invite: email it, or return the link to show. */
  deliverInvite: (inviteId: string, token: string) => Promise<string | void>;
  now?: Date;
}

export interface ProvisionChange {
  site: string;
  action: 'site.create' | 'site.update' | 'membership.create' | 'membership.update' | 'membership.delete' | 'invite.create' | 'invite.revoke';
  detail: string;
  /** The invite link, when the delivery returns one. */
  link?: string;
}

export class ProvisionError extends Error {}

type Access = { role: Role; until: Date | null };

type Op =
  | { kind: 'membership.create'; email: string; userId: mongoose.Types.ObjectId; access: Access }
  | { kind: 'membership.update'; email: string; m: MembershipDoc; access: Access }
  | { kind: 'membership.delete'; email: string; m: MembershipDoc }
  | { kind: 'invite.create'; email: string; access: Access }
  | { kind: 'invite.revoke'; email: string; invite: InviteDoc };

const SITE_DETAILS = ['name', 'externalId', 'address', 'tz', 'lat', 'lon', 'currency', 'billDay', 'demandCapKw'] as const;

const same = (a: Access, b: { role: string; until?: Date | null }) => a.role === b.role && (a.until?.getTime() ?? null) === (b.until?.getTime() ?? null);
const lasting = (a: { role: string; until?: Date | null }) => a.role === 'owner' && !a.until;
const describe = (a: Access, tz: string) => `${a.role}${a.until ? ` until ${endLabel(a.until, tz)}` : ''}`;
const endLabel = (until: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(until.getTime() - 1));

/** The site the plan means: by external id, else by name (adopting a site made in the app). */
const findSite = async (s: PlanSite): Promise<SiteDoc | null> => {
  if (s.externalId) {
    const byId = await Site.findOne({ externalId: s.externalId }).lean<SiteDoc>();
    if (byId) return byId;
  }
  const byName = await Site.find({ name: s.name, ...(s.externalId ? { externalId: null } : {}) }).limit(2).lean<SiteDoc[]>();
  if (byName.length > 1) throw new ProvisionError(`${s.name}: several sites have this name; give it an externalId`);
  return byName[0] ?? null;
};

/** What changes for one site's people, and a check that it keeps an owner. */
const planPeople = async (s: PlanSite, site: SiteDoc | null, tz: string, now: Date, prune: boolean): Promise<Op[]> => {
  const access = (m: PlanMember): Access => {
    const until = m.until ? endOfLocalDate(m.until, tz) : null;
    if (until && until <= now) throw new ProvisionError(`${s.name}: ${m.email}'s access would already have ended (${m.until})`);
    return { role: m.role, until };
  };
  const listed = new Map(s.members.map((m) => [m.email, access(m)]));
  const users = await User.find({ email: { $in: [...listed.keys()] } }).select('_id email').lean();
  const userByEmail = new Map(users.map((u) => [u.email, u._id as mongoose.Types.ObjectId]));

  const memberships = site ? await Membership.find({ siteId: site._id }).lean<MembershipDoc[]>() : [];
  const invites = site ? await Invite.find({ siteId: site._id, acceptedAt: null, expiresAt: { $gt: now } }).lean<InviteDoc[]>() : [];
  const members = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('_id email').lean();
  const emailOf = new Map(members.map((u) => [String(u._id), u.email]));

  const ops: Op[] = [];
  for (const [email, a] of listed) {
    const userId = userByEmail.get(email);
    const m = userId ? memberships.find((x) => String(x.userId) === String(userId)) : undefined;
    if (m) {
      if (!same(a, m) || m.source !== 'provisioning') ops.push({ kind: 'membership.update', email, m, access: a });
    } else if (userId) {
      ops.push({ kind: 'membership.create', email, userId, access: a });
    } else {
      const pending = invites.find((i) => i.email === email);
      if (!pending || !same(a, pending) || pending.source !== 'provisioning') ops.push({ kind: 'invite.create', email, access: a });
    }
  }
  if (prune) {
    for (const m of memberships) {
      const email = emailOf.get(String(m.userId)) ?? '(former user)';
      if (m.source === 'provisioning' && !listed.has(email)) ops.push({ kind: 'membership.delete', email, m });
    }
    for (const i of invites) if (i.source === 'provisioning' && !listed.has(i.email)) ops.push({ kind: 'invite.revoke', email: i.email, invite: i });
  }

  // After the changes: an owner with lasting access, or an invite on its way to one.
  const removed = new Set(ops.flatMap((o) => (o.kind === 'membership.delete' ? [String(o.m._id)] : [])));
  const updated = new Map(ops.flatMap((o) => (o.kind === 'membership.update' ? [[String(o.m._id), o.access] as const] : [])));
  const revoked = new Set(ops.flatMap((o) => (o.kind === 'invite.revoke' ? [String(o.invite._id)] : [])));
  const replaced = new Set(ops.flatMap((o) => (o.kind === 'invite.create' ? [o.email] : [])));
  const keepsOwner =
    memberships.some((m) => !removed.has(String(m._id)) && lasting(updated.get(String(m._id)) ?? m) && (!m.until || m.until > now)) ||
    ops.some((o) => (o.kind === 'membership.create' || o.kind === 'invite.create') && lasting(o.access)) ||
    invites.some((i) => !revoked.has(String(i._id)) && !replaced.has(i.email) && lasting(i));
  if (!keepsOwner) throw new ProvisionError(`${s.name}: the site would have no owner with lasting access; list one with "role": "owner" and no "until"`);
  return ops;
};

/** The site's details the plan sets that differ from what is stored. */
const siteChanges = (s: PlanSite, site: SiteDoc | null) => {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of SITE_DETAILS) {
    const want = s[k];
    if (want === undefined) continue;
    const have = site ? (site as unknown as Record<string, unknown>)[k] : undefined;
    if (site && have === want) continue;
    before[k] = have ?? null;
    after[k] = want;
  }
  return { before, after };
};

const applySite = async (s: PlanSite, opts: ProvisionOptions, now: Date): Promise<ProvisionChange[]> => {
  const found = await findSite(s);
  const tz = s.tz ?? found?.tz ?? 'UTC';
  const ops = await planPeople(s, found, tz, now, !!opts.prune);
  const { before, after } = siteChanges(s, found);
  const changes: ProvisionChange[] = [];
  const opChange = new Map<Op, ProvisionChange>();
  const note = (action: ProvisionChange['action'], detail: string, o?: Op) => {
    const change: ProvisionChange = { site: s.name, action, detail };
    changes.push(change);
    if (o) opChange.set(o, change);
  };

  if (!found) note('site.create', `created (time zone ${tz})`);
  else if (Object.keys(after).length) note('site.update', `changed ${Object.keys(after).join(', ')}`);
  for (const o of ops) {
    if (o.kind === 'membership.create') note(o.kind, `${o.email}: ${describe(o.access, tz)}`, o);
    if (o.kind === 'membership.update') note(o.kind, `${o.email}: ${describe(o.access, tz)}${o.m.source !== 'provisioning' ? ' (now managed by provisioning)' : ''}`, o);
    if (o.kind === 'membership.delete') note(o.kind, `${o.email}: removed`, o);
    if (o.kind === 'invite.create') note(o.kind, `${o.email}: invited as ${describe(o.access, tz)}`, o);
    if (o.kind === 'invite.revoke') note(o.kind, `${o.email}: invite withdrawn`, o);
  }
  if (opts.dryRun) return changes;

  let site: SiteDoc;
  if (!found) {
    site = (await Site.create({ ...after, tz })).toObject() as SiteDoc;
    await recordAudit({ siteId: site._id, userId: null, action: 'site.create', target: `site:${site._id}`, after: { ...after, tz } });
  } else {
    site = found;
    if (Object.keys(after).length) {
      await Site.updateOne({ _id: site._id }, { $set: after });
      await recordAudit({ siteId: site._id, userId: null, action: 'site.update', target: `site:${site._id}`, before, after });
    }
  }

  const audit = (action: string, target: string, change: { before?: unknown; after?: unknown }) => recordAudit({ siteId: site._id, userId: null, action, target, ...change });
  for (const o of ops) {
    if (o.kind === 'membership.create') {
      const m = await Membership.create({ siteId: site._id, userId: o.userId, ...o.access, source: 'provisioning' });
      await audit('membership.create', `membership:${m._id}`, { after: { userId: String(o.userId), ...o.access, source: 'provisioning' } });
    } else if (o.kind === 'membership.update') {
      const set = { ...o.access, source: 'provisioning' as const };
      await Membership.updateOne({ _id: o.m._id }, { $set: set });
      await audit('membership.update', `membership:${o.m._id}`, { before: { role: o.m.role, until: o.m.until, source: o.m.source }, after: set });
    } else if (o.kind === 'membership.delete') {
      await Membership.deleteOne({ _id: o.m._id });
      await audit('membership.delete', `membership:${o.m._id}`, { before: { userId: String(o.m.userId), role: o.m.role, until: o.m.until } });
    } else if (o.kind === 'invite.revoke') {
      await Invite.deleteOne({ _id: o.invite._id });
      await audit('invite.revoke', `invite:${o.invite._id}`, { before: { email: o.email, role: o.invite.role } });
    } else {
      const { invite, token } = await issueInvite(site, null, { email: o.email, ...o.access, source: 'provisioning' }, now);
      const link = await opts.deliverInvite(String(invite._id), token);
      await audit('invite.create', `invite:${invite._id}`, { after: { email: o.email, ...o.access, source: 'provisioning' } });
      const change = opChange.get(o);
      if (link && change) change.link = link;
    }
  }
  return changes;
};

/**
 * Makes the database match the plan, site by site. Every site is checked before any is changed, so
 * a plan with a mistake changes nothing.
 */
export const applyPlan = async (plan: ProvisionPlan, opts: ProvisionOptions): Promise<ProvisionChange[]> => {
  const now = opts.now ?? new Date();
  const planned: ProvisionChange[] = [];
  for (const s of plan.sites) planned.push(...(await applySite(s, { ...opts, dryRun: true }, now)));
  if (opts.dryRun) return planned;
  const changes: ProvisionChange[] = [];
  for (const s of plan.sites) changes.push(...(await applySite(s, opts, now)));
  return changes;
};
