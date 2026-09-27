import { Router } from 'express';
import { memberPatch } from '@ecomanage/shared';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { listPeople, removeMember, updateMember } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'People request failed' } } };

// /api/site/members (Backend Coverage: owner only).
const router: Router = Router();
const owner = requireRole('owner');

router.get(
  '/',
  ...owner,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await listPeople(req.site!, userIdOf(req)));
  })
);

router.patch(
  '/:id',
  ...owner,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    res.json(await updateMember(req.site!, userIdOf(req), req.params.id, parseBody(memberPatch, req.body)));
  })
);

router.delete(
  '/:id',
  ...owner,
  handle(FALLBACK, async (req: AuthenticatedRequest, res) => {
    await removeMember(req.site!, userIdOf(req), req.params.id);
    res.status(204).end();
  })
);

export default router;
