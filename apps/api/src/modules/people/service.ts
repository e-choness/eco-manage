import mongoose from 'mongoose';
import { Invite, Membership, recordAudit, type InviteDoc, type MembershipDoc, type SiteDoc } from '@ecomanage/db';
import { endOfLocalDate, lastLocalDate, type MemberPatch, type MemberView, type PeopleResponse, type Role } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';
import { activeFilter } from '../site/service';
import { inviteView } from '../invites/service';

// Settings → People (P4-08, owner only): who has access and until when, pending invites. A site
// always keeps at least one owner with lasting access.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

export const listPeople = async (site: SiteDoc, userId: string, now = new Date()): Promise<PeopleResponse> => {
  const [memberships, invites] = await Promise.all([
    Membership.find({ siteId: site._id, ...activeFilter(now) }).sort({ createdAt: 1 }).lean<MembershipDoc[]>(),
    Invite.find({ siteId: site._id, acceptedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).lean<InviteDoc[]>(),
  ]);
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('name email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    members: memberships.map(
      (m): MemberView => ({
        id: String(m._id),
        userId: String(m.userId),
        name: byId.get(String(m.userId))?.name || byId.get(String(m.userId))?.email || 'Former user',
        email: byId.get(String(m.userId))?.email ?? '',
        role: m.role as Role,
        until: m.until ? lastLocalDate(m.until, site.tz) : null,
        you: String(m.userId) === userId,
      })
    ),
    invites: await Promise.all(invites.map((i) => inviteView(i, site.tz))),
  };
};

const findMember = async (site: SiteDoc, id: string) => {
  const m = mongoose.isValidObjectId(id) ? await Membership.findOne({ _id: id, siteId: site._id }).lean<MembershipDoc>() : null;
  if (!m) throw fail(404, 'Person not found');
  return m;
};

/** Other owners who keep access for good (no end date). */
const otherLastingOwners = (site: SiteDoc, except: MembershipDoc) =>
  Membership.countDocuments({ siteId: site._id, role: 'owner', until: null, _id: { $ne: except._id } });

export const updateMember = async (site: SiteDoc, userId: string, id: string, patch: MemberPatch, now = new Date()): Promise<MemberView> => {
  const m = await findMember(site, id);
  const until = patch.until === undefined ? m.until : patch.until === null ? null : endOfLocalDate(patch.until, site.tz);
  if (until && until <= now) throw fail(400, 'Access must last until today or later; remove the person instead');
  const staysLastingOwner = (patch.role ?? m.role) === 'owner' && until === null;
  if (m.role === 'owner' && m.until === null && !staysLastingOwner && (await otherLastingOwners(site, m)) === 0)
    throw fail(409, 'A site needs at least one owner with lasting access');
  const set = { ...(patch.role ? { role: patch.role } : {}), ...(patch.until !== undefined ? { until } : {}) };
  await Membership.updateOne({ _id: m._id }, { $set: set });
  await recordAudit({ siteId: site._id, userId, action: 'membership.update', target: `membership:${id}`, before: { role: m.role, until: m.until }, after: set });
  const view = (await listPeople(site, userId, now)).members.find((x) => x.id === id);
  if (!view) throw fail(404, 'Person not found');
  return view;
};

export const removeMember = async (site: SiteDoc, userId: string, id: string): Promise<void> => {
  const m = await findMember(site, id);
  if (m.role === 'owner' && m.until === null && (await otherLastingOwners(site, m)) === 0) throw fail(409, 'A site needs at least one owner with lasting access');
  await Membership.deleteOne({ _id: m._id });
  await recordAudit({ siteId: site._id, userId, action: 'membership.delete', target: `membership:${id}`, before: { userId: String(m.userId), role: m.role, until: m.until } });
};

/** Takes back an invite that hasn't been accepted: its link stops working. */
export const revokeInvite = async (site: SiteDoc, userId: string, id: string): Promise<void> => {
  const i = mongoose.isValidObjectId(id) ? await Invite.findOne({ _id: id, siteId: site._id, acceptedAt: null }).lean<InviteDoc>() : null;
  if (!i) throw fail(404, 'Invite not found');
  await Invite.deleteOne({ _id: i._id });
  await recordAudit({ siteId: site._id, userId, action: 'invite.revoke', target: `invite:${id}`, before: { email: i.email, role: i.role } });
};
