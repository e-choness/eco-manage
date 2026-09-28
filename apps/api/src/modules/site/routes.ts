import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import type { GatewayLink } from '../../lib/gatewayLink';
import type { JobClient } from '../../lib/jobs';
import { siteController, type SiteControllerDeps } from './controller';
import { settingsController } from './settingsController';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { explanationSettingsInput, explanationTestInput, siteModelInput, type Role } from '@ecomanage/shared';
import type { ExplainDeps } from '../recommendations/llm';
import { explanationSettings, removeExplanationSettings, saveExplanationSettings, testExplanationSettings } from './explanations';
import { saveSiteModel, siteModel, siteToday } from './home';
import { findOsmFootprint, osmQuery, type OsmLookup } from './osm';
import type { CertSigner } from '../gateway/signer';

const ALL = ['owner', 'manager', 'installer'] as const;

// Settings → Site roles (App v2): details owner; arrays and battery owner or installer.
export const siteRoutes = (deps: SiteControllerDeps & { gateway?: GatewayLink; jobs?: JobClient; osm?: OsmLookup; signer?: CertSigner; explain?: ExplainDeps }): Router => {
  const router: Router = Router();
  const site = siteController(deps);
  const settings = settingsController(deps);
  router.get('/', ...requireRole(...ALL), settings.get);
  router.patch('/', ...requireRole('owner'), settings.patch);
  router.put('/pv-arrays', ...requireRole('owner', 'installer'), settings.pvArrays);
  router.patch('/battery', ...requireRole('owner', 'installer'), settings.battery);
  router.get('/gateway', ...requireRole(...ALL), settings.gateway);
  router.post('/gateway/claim', ...requireRole('owner', 'installer'), settings.claim);
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
  // The generated model's outline from OpenStreetMap (P5-03).
  router.get(
    '/model/osm-footprint',
    ...requireRole('owner', 'installer'),
    handle(HOME_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await findOsmFootprint(deps.osm, req.site!, parseBody(osmQuery, req.query))))
  );
  // Settings → Rules → Explanations (owner, P5-05): the site's own language model.
  const LLM_FALLBACK = { status: 500, body: { error: { code: 500, message: 'Explanation settings request failed' } } };
  router.get('/explanations', ...requireRole('owner'), handle(LLM_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await explanationSettings(deps.explain, req.site!))));
  router.put(
    '/explanations',
    ...requireRole('owner'),
    handle(LLM_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await saveExplanationSettings(deps.explain, req.site!, userIdOf(req), parseBody(explanationSettingsInput, req.body))))
  );
  router.delete('/explanations', ...requireRole('owner'), handle(LLM_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await removeExplanationSettings(deps.explain, req.site!, userIdOf(req)))));
  router.post(
    '/explanations/test',
    ...requireRole('owner'),
    handle(LLM_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await testExplanationSettings(deps.explain, req.site!, parseBody(explanationTestInput, req.body && Object.keys(req.body).length ? req.body : undefined))))
  );
  router.get(
    '/today',
    ...requireRole(...ALL),
    handle(HOME_FALLBACK, async (req: AuthenticatedRequest, res) => void res.json(await siteToday(req.site!, req.membership!.role as Role)))
  );
  return router;
};
