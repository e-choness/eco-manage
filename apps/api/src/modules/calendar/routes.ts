import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as calendar from './controller';

// Everyone sees the calendar; owners and managers edit it (App v2 Settings → Calendar).
const router: Router = Router();

router.get('/', ...requireRole('owner', 'manager', 'installer'), calendar.get);
router.put('/', ...requireRole('owner', 'manager'), calendar.put);

export default router;
