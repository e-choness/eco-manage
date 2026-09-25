import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as alerts from './controller';

const router: Router = Router();

router.get('/', ...requireRole('owner', 'manager', 'installer'), alerts.list);
router.put('/read', ...requireRole('owner', 'manager', 'installer'), alerts.markRead);

export default router;
