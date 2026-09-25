import { z } from 'zod';
import * as financialService from './service';
import { handle, parse, userIdOf } from '../../lib/http';

const periodQuery = z.object({ period: z.string().default('year') });

export const overview = handle({ status: 500, body: { error: 'Failed to fetch financial overview' } }, async (req, res) => {
  const { period } = parse(periodQuery, req.query, 400, { error: 'Invalid period' });
  res.json(await financialService.overview(userIdOf(req), period));
});

export const history = handle({ status: 500, body: { error: 'Failed to fetch financial history' } }, async (req, res) => {
  const { period } = parse(periodQuery, req.query, 400, { error: 'Invalid period' });
  const data = await financialService.history(userIdOf(req), period);
  res.json({ period, data });
});
