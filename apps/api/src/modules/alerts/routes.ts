import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import { alertsController } from './controller';
import type { AlertDeps } from './service';

// Every role sees and handles alerts (Backend Coverage §3: all).
const ALL = ['owner', 'manager', 'installer'] as const;

export const alertsRoutes = (deps: AlertDeps): Router => {
  const router: Router = Router();
  const alerts = alertsController(deps);
  router.get('/', ...requireRole(...ALL), alerts.list);
  router.get('/:id', ...requireRole(...ALL), alerts.detail);
  router.post('/:id/ack', ...requireRole(...ALL), alerts.ack);
  router.post('/:id/snooze', ...requireRole(...ALL), alerts.snooze);
  router.post('/:id/resolve', ...requireRole(...ALL), alerts.resolve);
  router.post('/:id/fix', ...requireRole(...ALL), alerts.fix);
  return router;
};
