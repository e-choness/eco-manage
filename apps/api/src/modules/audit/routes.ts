import { Router } from 'express';
import { auditQuery } from '@ecomanage/shared';
import { handle, parseBody } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { listAudit } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Failed to load the audit log' } } };

// Owners read the audit log (Backend Coverage: GET /api/audit, owner). It is written by the
// services themselves (recordAudit) and never changed through the API.
const router: Router = Router();

router.get(
  '/',
  ...requireRole('owner'),
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await listAudit(req.site!, parseBody(auditQuery, req.query)));
  })
);

export default router;
