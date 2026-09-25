import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import * as deviceService from './service';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';

const required = z.object({ name: z.string().min(1), type: z.string().min(1), maxOutput: z.coerce.number().optional() });
const typed = required.extend({ type: z.enum(deviceService.DEVICE_TYPES) });
const update = z
  .object({
    name: z.string().trim().min(1).optional(),
    maxOutput: z.coerce.number().min(0).optional(),
    status: z.enum(deviceService.DEVICE_STATUSES).optional(),
  })
  .strict()
  .refine((u) => Object.keys(u).length > 0);

const NOT_FOUND = { error: 'Device not found' };

// Malformed ids can't match a device, so they get the same 404 as unknown ones.
const deviceIdOf = (req: AuthenticatedRequest): string => {
  if (!isValidObjectId(req.params.id)) throw new HttpError(404, NOT_FOUND);
  return req.params.id;
};

export const list = handle({ status: 500, body: { error: 'Failed to fetch devices' } }, async (req, res) => {
  const devices = await deviceService.listDevices(userIdOf(req));
  res.json({ devices });
});

export const create = handle({ status: 500, body: { error: 'Failed to create device' } }, async (req, res) => {
  parse(required, req.body, 400, { error: 'Missing required fields: name, type' });
  const input = parse(typed, req.body, 400, { error: 'Invalid device type. Must be: solar, wind, battery, or grid' });
  const device = await deviceService.createDevice(userIdOf(req), input);
  res.status(201).json(device);
});

export const updateOne = handle({ status: 500, body: { error: 'Failed to update device' } }, async (req, res) => {
  const deviceId = deviceIdOf(req);
  const changes = parse(update, req.body, 400, { error: 'Invalid device update' });
  const device = await deviceService.updateDevice(userIdOf(req), deviceId, changes);
  if (!device) throw new HttpError(404, NOT_FOUND);
  res.json(device);
});

export const removeOne = handle({ status: 500, body: { error: 'Failed to delete device' } }, async (req, res) => {
  const deleted = await deviceService.deleteDevice(userIdOf(req), deviceIdOf(req));
  if (!deleted) throw new HttpError(404, NOT_FOUND);
  res.status(204).end();
});
