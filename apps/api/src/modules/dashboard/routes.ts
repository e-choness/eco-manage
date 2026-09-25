import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as dashboard from './controller';

const router: Router = Router();

router.get('/overview', requireUser, dashboard.overview);
router.get('/energy-flow', requireUser, dashboard.energyFlow);

export default router;
