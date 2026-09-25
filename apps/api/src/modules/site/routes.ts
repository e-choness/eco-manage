import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import { siteController, type SiteControllerDeps } from './controller';

export const siteRoutes = (deps: SiteControllerDeps): Router => {
  const router: Router = Router();
  const site = siteController(deps);
  router.get('/snapshot', ...requireRole('owner', 'manager', 'installer'), site.snapshot);
  router.get('/stream', ...requireRole('owner', 'manager', 'installer'), site.stream);
  return router;
};
