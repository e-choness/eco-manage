import { z } from 'zod';
import * as alertService from './service';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';

const markReadBody = z.object({ alertId: z.string().min(1) });

export const list = handle({ status: 500, body: { error: 'Failed to fetch alerts' } }, async (req, res) => {
  const alerts = await alertService.listAlerts(userIdOf(req));
  res.json({ alerts });
});

export const markRead = handle({ status: 500, body: { error: 'Failed to update alert' } }, async (req, res) => {
  const { alertId } = parse(markReadBody, req.body, 400, { error: 'Missing alertId' });
  const alert = await alertService.markRead(userIdOf(req), alertId);
  if (!alert) throw new HttpError(404, { error: 'Alert not found' });
  res.json(alert);
});
