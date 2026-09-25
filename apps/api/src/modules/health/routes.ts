import { Router } from 'express';
import * as health from './controller';

const router: Router = Router();

router.get('/', health.welcome);
router.get('/ping', health.ping);

export default router;
