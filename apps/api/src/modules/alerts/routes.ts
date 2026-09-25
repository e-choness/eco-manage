import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as alerts from './controller';

const router: Router = Router();

router.get('/', requireUser, alerts.list);
router.put('/read', requireUser, alerts.markRead);

export default router;
