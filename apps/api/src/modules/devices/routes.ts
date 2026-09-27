import { Router } from 'express';
import type { Redis } from 'ioredis';
import { requireRole } from '../../middleware/roles';
import type { GatewayLink } from '../../lib/gatewayLink';
import { devicesController } from './controller';

// Everyone on the site can see devices; only installers add, change or remove them (spec §1).
export const devicesRoutes = (redis?: Redis, gateway?: GatewayLink): Router => {
  const router: Router = Router();
  const devices = devicesController(redis, gateway);
  const all = requireRole('owner', 'manager', 'installer');
  const installer = requireRole('installer');
  router.get('/', ...all, devices.list);
  router.post('/', ...installer, devices.create);
  router.post('/scan', ...installer, devices.scan);
  router.get('/:id', ...all, devices.detail);
  router.get('/:id/telemetry', ...all, devices.telemetry);
  router.patch('/:id', ...installer, devices.update);
  router.delete('/:id', ...installer, devices.remove);
  router.post('/:id/commission', ...installer, devices.commission);
  router.post('/:id/maintenance', ...installer, devices.maintenance);
  return router;
};
