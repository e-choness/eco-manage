import { z } from 'zod';
import * as deviceService from './service';
import { handle, parse, userIdOf } from '../../lib/http';

const required = z.object({ name: z.string().min(1), type: z.string().min(1), maxOutput: z.coerce.number().optional() });
const typed = required.extend({ type: z.enum(deviceService.DEVICE_TYPES) });

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
