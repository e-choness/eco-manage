import { Router } from 'express';
import { approvalPatch, rulePatch } from '@ecomanage/shared';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { listRules, updateApproval, updateRule } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Rules request failed' } } };

// Everyone reads the rules; owners and managers change them (Backend Coverage).
const router: Router = Router();

router.get(
  '/',
  ...requireRole('owner', 'manager', 'installer'),
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await listRules(req.site!));
  })
);

router.patch(
  '/:ruleId',
  ...requireRole('owner', 'manager'),
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    const site = req.site!;
    res.json(
      req.params.ruleId === 'approval'
        ? await updateApproval(site, userIdOf(req), parseBody(approvalPatch, req.body))
        : await updateRule(site, userIdOf(req), req.params.ruleId, parseBody(rulePatch, req.body))
    );
  })
);

export default router;
