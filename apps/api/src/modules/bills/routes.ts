import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import type { JobClient } from '../../lib/jobs';
import { billsController, utilityUpload } from './controller';

// Money is for owners and managers (spec §1); only the owner adds the utility's bill.
export const billsRoutes = (jobs?: JobClient): Router => {
  const router: Router = Router();
  const bills = billsController(jobs);
  router.get('/', ...requireRole('owner', 'manager'), bills.list);
  router.get('/range', ...requireRole('owner', 'manager'), bills.range);
  router.get('/:period', ...requireRole('owner', 'manager'), bills.detail);
  router.get('/:period/statement', ...requireRole('owner', 'manager'), bills.statement);
  router.post('/:period/utility-bill', ...requireRole('owner'), utilityUpload, bills.utilityBill);
  return router;
};
