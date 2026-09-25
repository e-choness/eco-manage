import { z } from 'zod';
import * as analyticsService from './service';
import { handle, parse, userIdOf } from '../../lib/http';

const periodQuery = z.object({ period: z.string().default('month') });
const insightBody = z.object({ data: z.unknown().refine((d) => !!d) });

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

export const insight = handle({ status: 500, body: { error: 'Failed to generate insight' } }, async (req, res) => {
  const { data } = parse(insightBody, req.body, 400, { error: 'Missing data field' });
  res.json({ insight: await analyticsService.insight(data) });
});
