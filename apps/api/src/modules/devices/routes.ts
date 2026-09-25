import { Router } from 'express';
import type { Redis } from 'ioredis';
import { requireRole } from '../../middleware/roles';
import { devicesController } from './controller';

// Everyone on the site can see devices; only installers add, change or remove them (spec §1).
export const devicesRoutes = (redis?: Redis): Router => {
  const router: Router = Router();
  const devices = devicesController(redis);
  const all = requireRole('owner', 'manager', 'installer');
  const installer = requireRole('installer');
  router.get('/', ...all, devices.list);
  router.post('/', ...installer, devices.create);
  router.get('/:id', ...all, devices.detail);
  router.get('/:id/telemetry', ...all, devices.telemetry);
  router.patch('/:id', ...installer, devices.update);
  router.delete('/:id', ...installer, devices.remove);
  return router;
};
