import { fixAlertBody, resolveAlertBody } from '@ecomanage/shared';
import { handle, parseBody, userIdOf, paramOf } from '../../lib/http';
import { openClosedQuery } from '../../lib/lists';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as alerts from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Alert request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;
const idOf = (req: AuthenticatedRequest) => String(paramOf(req, 'id'));

export const alertsController = (deps: alerts.AlertDeps) => ({
  list: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.listAlerts(siteOf(req), parseBody(openClosedQuery, req.query)));
  }),
  detail: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.alertDetail(siteOf(req), idOf(req)));
  }),
  ack: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.ack(deps, siteOf(req), userIdOf(req), idOf(req)));
  }),
  snooze: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.snooze(deps, siteOf(req), userIdOf(req), idOf(req)));
  }),
  resolve: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.resolve(deps, siteOf(req), userIdOf(req), idOf(req), parseBody(resolveAlertBody, req.body)));
  }),
  fix: handle(FALLBACK, async (req, res) => {
    const { fixId } = parseBody(fixAlertBody, req.body);
    res.status(202).json(await alerts.fix(deps, siteOf(req), userIdOf(req), idOf(req), fixId));
  }),
});
