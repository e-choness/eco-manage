import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import type { GatewayLink } from '../../lib/gatewayLink';
import type { JobClient } from '../../lib/jobs';
import { siteController, type SiteControllerDeps } from './controller';
import { settingsController } from './settingsController';

const ALL = ['owner', 'manager', 'installer'] as const;

// Settings → Site roles (App v2): details owner; arrays and battery owner or installer.
export const siteRoutes = (deps: SiteControllerDeps & { gateway?: GatewayLink; jobs?: JobClient }): Router => {
  const router: Router = Router();
  const site = siteController(deps);
  const settings = settingsController(deps);
  router.get('/', ...requireRole(...ALL), settings.get);
  router.patch('/', ...requireRole('owner'), settings.patch);
  router.put('/pv-arrays', ...requireRole('owner', 'installer'), settings.pvArrays);
  router.patch('/battery', ...requireRole('owner', 'installer'), settings.battery);
  router.get('/gateway', ...requireRole(...ALL), settings.gateway);
  router.get('/snapshot', ...requireRole(...ALL), site.snapshot);
  router.get('/stream', ...requireRole(...ALL), site.stream);
  return router;
};
