import { z } from 'zod';
import * as optimizationService from './service';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';

const decisionBody = z.object({ recommendationId: z.string().min(1) });

export const recommendations = handle({ status: 500, body: { error: 'Failed to fetch recommendations' } }, async (req, res) => {
  const list = await optimizationService.listOpen(userIdOf(req));
  res.json({ recommendations: list });
});

export const accept = handle({ status: 500, body: { error: 'Failed to accept recommendation' } }, async (req, res) => {
  const { recommendationId } = parse(decisionBody, req.body, 400, { error: 'Missing recommendationId' });
  const recommendation = await optimizationService.accept(userIdOf(req), recommendationId);
  if (!recommendation) throw new HttpError(404, { error: 'Recommendation not found' });
  res.json(recommendation);
});

export const dismiss = handle({ status: 500, body: { error: 'Failed to dismiss recommendation' } }, async (req, res) => {
  const { recommendationId } = parse(decisionBody, req.body, 400, { error: 'Missing recommendationId' });
  const recommendation = await optimizationService.dismiss(userIdOf(req), recommendationId);
  if (!recommendation) throw new HttpError(404, { error: 'Recommendation not found' });
  res.json(recommendation);
});
