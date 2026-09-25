import { z } from 'zod';
import { fixAlertBody, resolveAlertBody } from '@ecomanage/shared';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as alerts from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Alert request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;
const idOf = (req: AuthenticatedRequest) => String(req.params.id);

const listQuery = z
  .object({
    state: z.enum(['open', 'closed']).default('open'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.date().optional(),
  })
  .strict();

export const alertsController = (deps: alerts.AlertDeps) => ({
  list: handle(FALLBACK, async (req, res) => {
    res.json(await alerts.listAlerts(siteOf(req), parseBody(listQuery, req.query)));
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
