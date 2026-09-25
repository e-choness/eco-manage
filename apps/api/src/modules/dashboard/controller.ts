import * as dashboardService from './service';
import { handle, userIdOf } from '../../lib/http';

export const overview = handle({ status: 500, body: { error: 'Failed to fetch dashboard overview' } }, async (req, res) => {
  res.json(await dashboardService.overview(userIdOf(req)));
});

export const energyFlow = handle({ status: 500, body: { error: 'Failed to fetch energy flow' } }, async (req, res) => {
  res.json(await dashboardService.energyFlow(userIdOf(req)));
});
