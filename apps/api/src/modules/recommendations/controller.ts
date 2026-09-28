import { z } from 'zod';
import { adjustRecommendationBody, declineRecommendationBody, manualRecommendationBody, type Role } from '@ecomanage/shared';
import { HttpError, handle, parseBody, userIdOf, paramOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as recs from './service';
import { explainRecommendation } from './explain';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Recommendation request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;
const roleOf = (req: AuthenticatedRequest) => req.membership!.role as Role;
const idOf = (req: AuthenticatedRequest) => String(paramOf(req, 'id'));

const listQuery = z
  .object({
    state: z.enum(['open', 'closed']).default('open'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.date().optional(),
  })
  .strict();

export const recommendationsController = (deps: recs.RecDeps) => ({
  list: handle(FALLBACK, async (req, res) => {
    res.json(await recs.listRecommendations(siteOf(req), parseBody(listQuery, req.query)));
  }),
  detail: handle(FALLBACK, async (req, res) => {
    res.json(await recs.recommendationDetail(siteOf(req), roleOf(req), idOf(req), new Date(), !!deps.explain?.explainer));
  }),
  create: handle(FALLBACK, async (req, res) => {
    res.status(201).json(await recs.createManual(deps, siteOf(req), userIdOf(req), parseBody(manualRecommendationBody, req.body)));
  }),
  check: handle(FALLBACK, async (req, res) => {
    res.json(await recs.checkRecommendation(deps, siteOf(req), idOf(req), parseBody(adjustRecommendationBody, req.body ?? {}).params));
  }),
  approve: handle(FALLBACK, async (req, res) => {
    const { params } = parseBody(adjustRecommendationBody, req.body ?? {});
    res.json(await recs.approve(deps, siteOf(req), userIdOf(req), roleOf(req), idOf(req), params));
  }),
  // P5-05: only the recommendation's id comes from the request; nothing else is read.
  explain: handle(FALLBACK, async (req, res) => {
    if (!deps.explain) throw new HttpError(503, { error: { code: 503, message: 'Explanations are turned off on this server.' } });
    res.json(await explainRecommendation(deps.explain, siteOf(req), userIdOf(req), idOf(req)));
  }),
  decline: handle(FALLBACK, async (req, res) => {
    const { reason } = parseBody(declineRecommendationBody, req.body);
    res.json(await recs.decline(deps, siteOf(req), userIdOf(req), roleOf(req), idOf(req), reason));
  }),
});
