import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as analytics from './controller';

const router: Router = Router();

router.get('/production', ...requireRole('owner', 'manager', 'installer'), analytics.production);
router.get('/consumption', ...requireRole('owner', 'manager', 'installer'), analytics.consumption);

export default router;
