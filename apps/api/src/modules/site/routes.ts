import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import type { GatewayLink } from '../../lib/gatewayLink';
import type { JobClient } from '../../lib/jobs';
import { siteController, type SiteControllerDeps } from './controller';
import { settingsController } from './settingsController';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { siteModelInput, type Role } from '@ecomanage/shared';
import { saveSiteModel, siteModel, siteToday } from './home';

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
  // Home (P4-03)
  const HOME_FALLBACK = { status: 500, body: { error: { code: 500, message: 'Failed to load Home' } } };
  router.get('/model', ...requireRole(...ALL), handle(HOME_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await siteModel(req.site!))));
  router.put(
    '/model',
    ...requireRole('owner', 'installer'),
    handle(HOME_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await saveSiteModel(req.site!, userIdOf(req), parseBody(siteModelInput, req.body))))
  );
  router.get(
    '/today',
    ...requireRole(...ALL),
    handle(HOME_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await siteToday(req.site!, req.membership!.role as Role)))
  );
  return router;
};
