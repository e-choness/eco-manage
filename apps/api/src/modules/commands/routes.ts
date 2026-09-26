import { Router } from 'express';
import type { Redis } from 'ioredis';
import { handle, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import * as commands from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Command request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

// Everyone sees what is running; owners and managers can stop it early (Backend Coverage).
export const commandsRoutes = (redis?: Redis): Router => {
  const router: Router = Router();
  router.get(
    '/',
    ...requireRole('owner', 'manager', 'installer'),
    handle(FALLBACK, async (req, res) => {
      res.json(await commands.activeCommands(siteOf(req)));
    })
  );
  router.get(
    '/:id',
    ...requireRole('owner', 'manager', 'installer'),
    handle(FALLBACK, async (req, res) => {
      res.json(await commands.commandDetail(siteOf(req), String(req.params.id)));
    })
  );
  router.post(
    '/:id/cancel',
    ...requireRole('owner', 'manager'),
    handle(FALLBACK, async (req, res) => {
      res.json(await commands.cancel(redis, siteOf(req), userIdOf(req), String(req.params.id)));
    })
  );
  return router;
};
