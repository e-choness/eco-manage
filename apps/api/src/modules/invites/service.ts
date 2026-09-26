import { createHash, randomBytes } from 'node:crypto';
import { Invite, Membership, Site, recordAudit, type InviteDoc, type SiteDoc } from '@ecomanage/db';
import { INVITE_DAYS, MIN_PASSWORD, type InviteAccept, type InviteCreate, type InvitePreview, type InviteView } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import User, { type IUser } from '../auth/model';
import UserService from '../auth/userService';
import { startSession, type Session } from '../auth/service';
import { activeFilter } from '../site/service';

// Invites (P4-02). EcoManage is invite-only: accounts are created by accepting an invite. The link
// holds a random token; only its SHA-256 is stored, and the plain token exists only in the email.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const nameOf = async (userId: unknown): Promise<string | null> => {
  if (!userId) return null;
  const u = await User.findById(userId).select('name email').lean();
  return u ? u.name || u.email : null;
};

const toView = async (i: InviteDoc): Promise<InviteView> => ({
  id: String(i._id),
  email: i.email,
  role: i.role as InviteView['role'],
  until: i.until ? i.until.toISOString() : null,
  expiresAt: i.expiresAt.toISOString(),
  invitedBy: await nameOf(i.invitedBy),
});

/** Owner invites someone: a new link replaces any unused one for the same address. */
export const createInvite = async (jobs: JobClient | undefined, site: SiteDoc, userId: string, input: InviteCreate, now = new Date()): Promise<InviteView> => {
  if (!jobs) throw fail(503, "Invites can't be emailed right now (no Redis)");
  const until = input.until ? new Date(input.until) : null;
  if (until && until <= now) throw fail(400, 'Access must end in the future');
  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing && (await Membership.exists({ siteId: site._id, userId: existing._id, ...activeFilter(now) })))
    throw fail(409, 'This person already has access to the site');

  const token = randomBytes(32).toString('base64url');
  await Invite.deleteMany({ siteId: site._id, email: input.email, acceptedAt: null });
  const invite = await Invite.create({
    siteId: site._id,
    email: input.email,
    role: input.role,
    until,
    invitedBy: userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
  });
  try {
    await jobs.sendInvite({ inviteId: String(invite._id), token });
  } catch {
    await Invite.deleteOne({ _id: invite._id });
    throw fail(503, "The invite email couldn't be queued. Try again in a minute.");
  }
  await recordAudit({ siteId: site._id, userId, action: 'invite.create', target: `invite:${invite._id}`, after: { email: input.email, role: input.role, until } });
  return toView(invite.toObject() as InviteDoc);
};

/** The invite behind a link, if it can still be used. */
const usable = async (token: string, now: Date): Promise<InviteDoc> => {
  const invite = await Invite.findOne({ tokenHash: hashToken(token) }).lean<InviteDoc>();
  if (!invite) throw fail(404, 'This invite link is not valid. Check that you opened the whole link from the email.');
  if (invite.acceptedAt) throw fail(410, 'This invite has already been used. Sign in instead.');
  if (invite.expiresAt <= now) throw fail(410, 'This invite has expired. Ask the site owner to send a new one.');
  return invite;
};

export const previewInvite = async (token: string, now = new Date()): Promise<InvitePreview> => {
  const invite = await usable(token, now);
  const [site, account, invitedBy] = await Promise.all([
    Site.findById(invite.siteId).select('name').lean<Pick<SiteDoc, 'name'>>(),
    User.exists({ email: invite.email }),
    nameOf(invite.invitedBy),
  ]);
  if (!site) throw fail(410, 'The site for this invite no longer exists.');
  return {
    siteName: site.name,
    email: invite.email,
    role: invite.role as InvitePreview['role'],
    until: invite.until ? invite.until.toISOString() : null,
    expiresAt: invite.expiresAt.toISOString(),
    invitedBy,
    hasAccount: !!account,
  };
};

/**
 * Accepts an invite: signs in the existing account for its address (password) or creates one
 * (name and password), gives it the invited role on the site, and starts a session.
 */
export const acceptInvite = async (token: string, body: InviteAccept, now = new Date()): Promise<Session> => {
  const invite = await usable(token, now);
  const signIn = async (): Promise<IUser> => {
    const known = await UserService.authenticateWithPassword(invite.email, body.password);
    if (!known) throw fail(400, 'Password is incorrect for this account');
    return known;
  };
  const signUp = async (): Promise<IUser> => {
    if (!body.name) throw fail(400, 'Enter your name');
    if (body.password.length < MIN_PASSWORD) throw fail(400, `Use at least ${MIN_PASSWORD} characters for your password`);
    return UserService.create({ email: invite.email, password: body.password, name: body.name });
  };
  const user = (await User.exists({ email: invite.email })) ? await signIn() : await signUp();

  // Single use, even when two tabs accept at once.
  const claimed = await Invite.findOneAndUpdate({ _id: invite._id, acceptedAt: null, expiresAt: { $gt: now } }, { $set: { acceptedAt: now } });
  if (!claimed) throw fail(410, 'This invite has already been used. Sign in instead.');
  await Membership.findOneAndUpdate(
    { siteId: invite.siteId, userId: user._id },
    { $set: { role: invite.role, until: invite.until } },
    { upsert: true }
  );
  await recordAudit({
    siteId: invite.siteId,
    userId: String(user._id),
    action: 'invite.accept',
    target: `invite:${invite._id}`,
    after: { email: invite.email, role: invite.role, until: invite.until },
  });
  return startSession(user);
};
