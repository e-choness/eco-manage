import { Router } from 'express';
import { historyQuery, totalsQuery, type Role } from '@ecomanage/shared';
import { handle, parseBody } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { historySeries, historyTotals } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'History request failed' } } };
const roleOf = (req: AuthenticatedRequest) => req.membership!.role as Role;

// Everyone sees history; money fields are null for installers (Backend Coverage).
const router: Router = Router();
const all = requireRole('owner', 'manager', 'installer');

router.get(
  '/series',
  ...all,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await historySeries(req.site!, roleOf(req), parseBody(historyQuery, req.query)));
  })
);

router.get(
  '/totals',
  ...all,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await historyTotals(req.site!, roleOf(req), parseBody(totalsQuery, req.query)));
  })
);

export default router;
