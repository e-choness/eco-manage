import { Router } from 'express';
import { requireUser } from '../../middleware/auth';
import * as auth from './controller';

const router: Router = Router();

router.post('/login', auth.login);
router.post('/register', auth.register);
router.post('/logout', auth.logout);
router.post('/refresh', auth.refresh);
router.get('/me', requireUser, auth.me);
router.put('/password', requireUser, auth.changePassword);
router.put('/profile', requireUser, auth.updateProfile);

export default router;
