import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as devices from './controller';

const router: Router = Router();

router.get('/', requireUser, devices.list);
router.post('/', requireUser, devices.create);
router.put('/:id', requireUser, devices.updateOne);
router.delete('/:id', requireUser, devices.removeOne);

export default router;
