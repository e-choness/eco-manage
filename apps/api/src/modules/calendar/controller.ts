import { calendarInput } from '@ecomanage/shared';
import { handle, parseBody, userIdOf } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as calendar from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Calendar request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

export const get = handle(FALLBACK, async (req, res) => {
  res.json(await calendar.getCalendar(siteOf(req)));
});

export const put = handle(FALLBACK, async (req, res) => {
  res.json(await calendar.putCalendar(siteOf(req), userIdOf(req), parseBody(calendarInput, req.body)));
});
