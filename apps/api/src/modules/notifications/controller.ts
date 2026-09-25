import { notificationPrefsPatch, type Role } from '@ecomanage/shared';
import { currentUser, handle, parseBody } from '../../lib/http';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as prefs from './service';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Notification settings request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

export const get = handle(FALLBACK, async (req, res) => {
  res.json(await prefs.getPrefs(siteOf(req), currentUser(req)));
});

export const patch = handle(FALLBACK, async (req, res) => {
  const body = parseBody(notificationPrefsPatch, req.body);
  res.json(await prefs.updatePrefs(siteOf(req), currentUser(req), req.membership!.role as Role, body));
});
