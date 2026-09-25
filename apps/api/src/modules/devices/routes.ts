import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as devices from './controller';

const router: Router = Router();

router.get('/', ...requireRole('owner', 'manager', 'installer'), devices.list);
router.post('/', ...requireRole('installer'), devices.create);
router.put('/:id', ...requireRole('installer'), devices.updateOne);
router.delete('/:id', ...requireRole('installer'), devices.removeOne);

export default router;
