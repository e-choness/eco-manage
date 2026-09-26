import { Router } from 'express';
import { inboxQuery } from '@ecomanage/shared';
import { handle, parseBody } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { inboxCounts, listInbox } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Inbox request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

// Everyone has an Inbox (Backend Coverage: GET /api/inbox, all roles). What each role may do with
// an item is decided by the item's own API (alerts, recommendations, commands).
const router: Router = Router();

router.get(
  '/',
  ...requireRole('owner', 'manager', 'installer'),
  handle(FALLBACK, async (req, res) => {
    res.json(await listInbox(siteOf(req), parseBody(inboxQuery, req.query)));
  })
);

router.get(
  '/counts',
  ...requireRole('owner', 'manager', 'installer'),
  handle(FALLBACK, async (req, res) => {
    res.json(await inboxCounts(siteOf(req)));
  })
);

export default router;
