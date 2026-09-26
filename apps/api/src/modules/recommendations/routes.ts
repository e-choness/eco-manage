import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import { recommendationsController } from './controller';
import type { RecDeps } from './service';

// Everyone sees decisions; owners and managers request and decide. Who may approve is further
// limited by Settings → Rules → Who can approve (checked in the service). Installers never approve.
const ALL = ['owner', 'manager', 'installer'] as const;
const DECIDERS = ['owner', 'manager'] as const;

export const recommendationsRoutes = (deps: RecDeps): Router => {
  const router: Router = Router();
  const recs = recommendationsController(deps);
  router.get('/', ...requireRole(...ALL), recs.list);
  router.post('/', ...requireRole(...DECIDERS), recs.create);
  router.get('/:id', ...requireRole(...ALL), recs.detail);
  router.post('/:id/check', ...requireRole(...DECIDERS), recs.check);
  router.post('/:id/approve', ...requireRole(...DECIDERS), recs.approve);
  router.post('/:id/decline', ...requireRole(...DECIDERS), recs.decline);
  return router;
};
