import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as financial from './controller';

const router: Router = Router();

router.get('/overview', ...requireRole('owner', 'manager'), financial.overview);
router.get('/history', ...requireRole('owner', 'manager'), financial.history);

export default router;
