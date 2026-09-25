import { isValidObjectId } from 'mongoose';
import { Membership, MembershipDoc, Site, SiteDoc } from '@ecomanage/db';
import type { Role } from '@ecomanage/shared';

export interface SiteContext {
  site: SiteDoc;
  membership: MembershipDoc;
}

// An installer's access (or anyone's) ends at `until`; an expired membership counts as none.
const activeFilter = (now: Date) => ({ $or: [{ until: null }, { until: { $gt: now } }] });

/**
 * The site a request acts on. With `requestedSiteId` (the X-Site-Id header) it must be one the
 * user belongs to; otherwise it's the user's oldest active membership. Null means no access.
 */
export const resolveSiteContext = async (
  userId: string,
  requestedSiteId?: string,
  now = new Date()
): Promise<SiteContext | null> => {
  if (requestedSiteId !== undefined && !isValidObjectId(requestedSiteId)) return null;
  const filter = { userId, ...activeFilter(now), ...(requestedSiteId ? { siteId: requestedSiteId } : {}) };
  const membership = await Membership.findOne(filter).sort({ createdAt: 1, _id: 1 }).lean<MembershipDoc>();
  if (!membership) return null;
  const site = await Site.findById(membership.siteId).lean<SiteDoc>();
  return site ? { site, membership } : null;
};

export interface MembershipSummary {
  siteId: string;
  siteName: string;
  role: Role;
  until: string | null;
}

/** Active memberships with their site names, for /auth/me. */
export const listMemberships = async (userId: string, now = new Date()): Promise<MembershipSummary[]> => {
  const memberships = await Membership.find({ userId, ...activeFilter(now) })
    .sort({ createdAt: 1, _id: 1 })
    .lean<MembershipDoc[]>();
  const sites = await Site.find({ _id: { $in: memberships.map((m) => m.siteId) } })
    .select('name')
    .lean<Pick<SiteDoc, '_id' | 'name'>[]>();
  const nameOf = new Map(sites.map((s) => [String(s._id), s.name]));
  return memberships
    .filter((m) => nameOf.has(String(m.siteId)))
    .map((m) => ({
      siteId: String(m.siteId),
      siteName: nameOf.get(String(m.siteId)) as string,
      role: m.role as Role,
      until: m.until ? m.until.toISOString() : null,
    }));
};
