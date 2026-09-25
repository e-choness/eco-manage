import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import type { JobClient } from '../../lib/jobs';
import { calendarController } from './controller';

// Everyone sees the calendar; owners and managers edit it (App v2 Settings → Calendar).
export const calendarRoutes = (jobs?: JobClient): Router => {
  const router: Router = Router();
  const calendar = calendarController(jobs);
  router.get('/', ...requireRole('owner', 'manager', 'installer'), calendar.get);
  router.put('/', ...requireRole('owner', 'manager'), calendar.put);
  return router;
};
