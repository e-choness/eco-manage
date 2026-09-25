import type { Redis } from 'ioredis';
import { createDeviceBody, patchDeviceBody, telemetryQuery } from '@ecomanage/shared';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as devices from './service';

// v2 error bodies: { error: { code, message } }
const fail = (code: number, message: string) => new HttpError(code, { error: { code, message } });
const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Device request failed' } } };
const NOT_FOUND = () => fail(404, 'Device not found');
const PROFILE_ERRORS: Record<string, string> = {
  'unknown-profile': 'Unknown device profile',
  'profile-type-mismatch': 'The profile does not support this device type',
};

const siteIdOf = (req: AuthenticatedRequest): string => String(req.site!._id);

const writeResult = (result: devices.WriteResult) => {
  if (result.ok) return result.device;
  throw result.reason === 'not-found' ? NOT_FOUND() : fail(400, PROFILE_ERRORS[result.reason]);
};

export const devicesController = (redis?: Redis) => {
  const needRedis = (): Redis => {
    if (!redis) throw fail(503, 'Live data is unavailable (no Redis)');
    return redis;
  };

  return {
    list: handle(FALLBACK, async (req, res) => {
      res.json({ items: await devices.listDevices(needRedis(), siteIdOf(req)) });
    }),

    detail: handle(FALLBACK, async (req, res) => {
      const device = await devices.getDevice(needRedis(), siteIdOf(req), req.params.id);
      if (!device) throw NOT_FOUND();
      res.json(device);
    }),

    telemetry: handle(FALLBACK, async (req, res) => {
      const q = parse(telemetryQuery, req.query, 400, { error: { code: 400, message: 'Invalid telemetry query' } });
      const series = await devices.telemetrySeries(siteIdOf(req), req.params.id, q);
      if (series === 'not-found') throw NOT_FOUND();
      if (series === 'range-invalid') throw fail(400, '"from" must be before "to"');
      if (series === 'range-too-long') throw fail(400, 'Range too long: at most 400 hourly points (16 days)');
      res.json(series);
    }),

    create: handle(FALLBACK, async (req, res) => {
      const body = parse(createDeviceBody, req.body, 400, { error: { code: 400, message: 'Invalid device' } });
      res.status(201).json(writeResult(await devices.createDevice(siteIdOf(req), userIdOf(req), body)));
    }),

    update: handle(FALLBACK, async (req, res) => {
      const patch = parse(patchDeviceBody, req.body, 400, { error: { code: 400, message: 'Invalid device update' } });
      res.json(writeResult(await devices.updateDevice(siteIdOf(req), userIdOf(req), req.params.id, patch)));
    }),

    remove: handle(FALLBACK, async (req, res) => {
      if (!(await devices.deleteDevice(siteIdOf(req), userIdOf(req), req.params.id))) throw NOT_FOUND();
      res.status(204).end();
    }),
  };
};
