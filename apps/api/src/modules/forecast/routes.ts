import { Router } from 'express';
import { handle } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { requireRole } from '../../middleware/roles';
import { getForecast } from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Forecast request failed' } } };

// All roles (Backend Coverage: GET /api/forecast).
const router: Router = Router();

router.get(
  '/',
  ...requireRole('owner', 'manager', 'installer'),
  handle(FALLBACK, async (req, res) => {
    res.json(await getForecast((req as AuthenticatedRequest).site!));
  })
);

export default router;
