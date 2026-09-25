import { tariffInput } from '@ecomanage/shared';
import { handle, HttpError, parse, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as tariffs from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Tariff request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

export const list = handle(FALLBACK, async (req, res) => {
  res.json(await tariffs.listTariffs(siteOf(req)));
});

export const templates = handle(FALLBACK, async (_req, res) => {
  res.json({ items: tariffs.templates() });
});

// 422 carries the gaps and overlaps so the Tariff settings can show them on the strip (P4-08).
export const create = handle(FALLBACK, async (req, res) => {
  const input = parse(tariffInput, req.body, 400, { error: { code: 400, message: 'Invalid tariff' } });
  const result = await tariffs.createTariff(siteOf(req), userIdOf(req), input);
  if (!result.ok) throw new HttpError(422, { error: { code: 422, message: 'The tariff has gaps or overlaps', details: { issues: result.issues } } });
  res.status(201).json(result.tariff);
});
