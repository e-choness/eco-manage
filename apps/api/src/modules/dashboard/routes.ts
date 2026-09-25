import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as dashboard from './controller';

const router: Router = Router();

router.get('/overview', ...requireRole('owner', 'manager', 'installer'), dashboard.overview);
router.get('/energy-flow', ...requireRole('owner', 'manager', 'installer'), dashboard.energyFlow);

export default router;
