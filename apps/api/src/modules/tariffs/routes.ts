import { Router } from 'express';
import { requireRole } from '../../middleware/roles';
import * as tariffs from './controller';

// Owners set the tariff; managers can see it (spec §1: money is hidden from installers).
const router: Router = Router();

router.get('/', ...requireRole('owner', 'manager'), tariffs.list);
router.get('/templates', ...requireRole('owner'), tariffs.templates);
router.post('/', ...requireRole('owner'), tariffs.create);

export default router;
