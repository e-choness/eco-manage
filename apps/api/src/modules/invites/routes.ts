import { Router } from 'express';
import { inviteAccept, inviteCreate } from '@ecomanage/shared';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { setRefreshCookie } from '../../utils/cookies';
import { acceptInvite, createInvite, previewInvite } from './service';

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
  return router;
};

/** /api/invites/:token: the link from the invite email. No sign-in needed; the token is the key. */
export const inviteRoutes = (): Router => {
  const router: Router = Router();
  router.get(
    '/:token',
    handle(FALLBACK, async (req, res) => {
      res.json(await previewInvite(req.params.token));
    })
  );
  router.post(
    '/:token/accept',
    handle(FALLBACK, async (req, res) => {
      const session = await acceptInvite(req.params.token, parseBody(inviteAccept, req.body));
      setRefreshCookie(res, session.refreshToken);
      res.json({ ...session.user.toJSON(), accessToken: session.accessToken });
    })
  );
  return router;
};
