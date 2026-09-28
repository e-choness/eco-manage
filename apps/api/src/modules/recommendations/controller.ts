import { adjustRecommendationBody, declineRecommendationBody, manualRecommendationBody, type Role } from '@ecomanage/shared';
import { handle, parseBody, userIdOf, paramOf } from '../../lib/http';
import { openClosedQuery } from '../../lib/lists';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as recs from './service';
import { explainRecommendation } from './explain';
import { resolveExplainer } from './llm';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Recommendation request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;
const roleOf = (req: AuthenticatedRequest) => req.membership!.role as Role;
const idOf = (req: AuthenticatedRequest) => String(paramOf(req, 'id'));

export const recommendationsController = (deps: recs.RecDeps) => ({
  list: handle(FALLBACK, async (req, res) => {
    res.json(await recs.listRecommendations(siteOf(req), parseBody(openClosedQuery, req.query)));
  }),
  detail: handle(FALLBACK, async (req, res) => {
    res.json(await recs.recommendationDetail(siteOf(req), roleOf(req), idOf(req), new Date(), !!resolveExplainer(deps.explain, siteOf(req))));
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
    res.json(await explainRecommendation(deps.explain, siteOf(req), userIdOf(req), idOf(req)));
  }),
  decline: handle(FALLBACK, async (req, res) => {
    const { reason } = parseBody(declineRecommendationBody, req.body);
    res.json(await recs.decline(deps, siteOf(req), userIdOf(req), roleOf(req), idOf(req), reason));
  }),
});
