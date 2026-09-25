import { z } from 'zod';
import * as analyticsService from './service';
import { handle, parse, userIdOf } from '../../lib/http';

const periodQuery = z.object({ period: z.string().default('month') });

export const production = handle({ status: 500, body: { error: 'Failed to fetch production analytics' } }, async (req, res) => {
  const { period } = parse(periodQuery, req.query, 400, { error: 'Invalid period' });
  const data = await analyticsService.production(userIdOf(req), period);
  res.json({ period, data });
});

export const consumption = handle({ status: 500, body: { error: 'Failed to fetch consumption analytics' } }, async (req, res) => {
  const { period } = parse(periodQuery, req.query, 400, { error: 'Invalid period' });
  const data = await analyticsService.consumption(userIdOf(req), period);
  res.json({ period, data });
});
