import { NextFunction, RequestHandler, Response } from 'express';
import type { Role } from '@ecomanage/shared';
import { AuthenticatedRequest, requireUser } from './auth';
import { resolveSiteContext } from '../modules/site/service';

export const ALL_ROLES: readonly Role[] = ['owner', 'manager', 'installer'];

const forbidden = (res: Response, message: string) => res.status(403).json({ error: { code: 403, message } });

/**
 * Resolves the site from the caller's membership and checks their role on it (plan §0.7).
 * Sets req.site and req.membership. Roles are always enforced here, never only in the UI.
 * Pick a site with the X-Site-Id header; without it the user's first active membership is used.
 */
const checkRole =
  (roles: readonly Role[]) =>
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requested = req.header('x-site-id') ?? undefined;
      const ctx = await resolveSiteContext(String(req.user!._id), requested);
      if (!ctx) {
        forbidden(res, 'No access to this site');
        return;
      }
      if (!roles.includes(ctx.membership.role as Role)) {
        forbidden(res, `Requires role: ${roles.join(' or ')}`);
        return;
      }
      req.site = ctx.site;
      req.membership = ctx.membership;
      next();
    } catch (err) {
      next(err);
    }
  };

/** Authentication, site context and role check in one: use on every site route. */
export const requireRole = (...roles: Role[]): RequestHandler[] => {
  if (roles.length === 0) throw new Error('requireRole needs at least one role');
  return [requireUser as RequestHandler, checkRole(roles) as RequestHandler];
};
