import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as optimization from './controller';

const router: Router = Router();

router.get('/recommendations', ...requireRole('owner', 'manager', 'installer'), optimization.recommendations);
router.post('/accept', ...requireRole('owner', 'manager'), optimization.accept);
router.post('/dismiss', ...requireRole('owner', 'manager'), optimization.dismiss);

export default router;
