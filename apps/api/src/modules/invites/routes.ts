import { Router } from 'express';
import { inviteAccept, inviteCreate } from '@ecomanage/shared';
import { handle, parseBody, userIdOf, paramOf } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { setRefreshCookie } from '../../utils/cookies';
import { acceptInvite, createInvite, previewInvite } from './service';
import { revokeInvite } from '../people/service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Invite request failed' } } };

/** POST /api/site/invites (owner): Settings → People → Add invite. */
export const siteInviteRoutes = (jobs?: JobClient): Router => {
  const router: Router = Router();
  router.post(
    '/',
    ...requireRole('owner'),
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      res.status(201).json(await createInvite(jobs, req.site!, userIdOf(req), parseBody(inviteCreate, req.body)));
    })
  );
  router.delete(
    '/:id',
    ...requireRole('owner'),
    handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
      await revokeInvite(req.site!, userIdOf(req), paramOf(req, 'id'));
      res.status(204).end();
    })
  );
  return router;
};

/** /api/invites/:token: the link from the invite email. No sign-in needed; the token is the key. */
export const inviteRoutes = (): Router => {
  const router: Router = Router();
  router.get(
    '/:token',
    handle(FALLBACK, async (req, res) => {
      res.json(await previewInvite(paramOf(req, 'token')));
    })
  );
  router.post(
    '/:token/accept',
    handle(FALLBACK, async (req, res) => {
      const session = await acceptInvite(paramOf(req, 'token'), parseBody(inviteAccept, req.body));
      setRefreshCookie(res, session.refreshToken);
      res.json({ ...session.user.toJSON(), accessToken: session.accessToken });
    })
  );
  return router;
};
