import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as notifications from './controller';

// Everyone manages their own notifications for the site (App v2 Settings → Notifications).
const router: Router = Router();

router.get('/notifications', ...requireRole('owner', 'manager', 'installer'), notifications.get);
router.patch('/notifications', ...requireRole('owner', 'manager', 'installer'), notifications.patch);

export default router;
