import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as analytics from './controller';

const router: Router = Router();

router.get('/production', requireUser, analytics.production);
router.get('/consumption', requireUser, analytics.consumption);

export default router;
