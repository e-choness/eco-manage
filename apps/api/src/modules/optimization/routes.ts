import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as optimization from './controller';

const router: Router = Router();

router.get('/recommendations', requireUser, optimization.recommendations);
router.post('/accept', requireUser, optimization.accept);
router.post('/dismiss', requireUser, optimization.dismiss);

export default router;
