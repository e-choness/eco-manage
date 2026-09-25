import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as financial from './controller';

const router: Router = Router();

router.get('/overview', requireUser, financial.overview);
router.get('/history', requireUser, financial.history);

export default router;
