import { NotificationPrefs, recordAudit, type NotificationPrefsDoc, type SiteDoc } from '@ecomanage/db';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs as Prefs, type NotificationPrefsPatch, type Role } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';

// Settings → Notifications (plan P2-09). They apply to the signed-in person on this site only.
// Command failures are always on for owners and managers (App v2).

const ALWAYS_FAILURES: Role[] = ['owner', 'manager'];

const toPrefs = (doc: NotificationPrefsDoc | null, fallbackEmail: string): Prefs => ({
  email: doc?.email ?? fallbackEmail,
  alerts: doc?.alerts ?? DEFAULT_NOTIFICATION_PREFS.alerts,
  daily: doc?.daily ?? DEFAULT_NOTIFICATION_PREFS.daily,
  recs: doc?.recs ?? DEFAULT_NOTIFICATION_PREFS.recs,
  failures: doc?.failures ?? DEFAULT_NOTIFICATION_PREFS.failures,
  quietFrom: doc ? (doc.quietFrom ?? null) : DEFAULT_NOTIFICATION_PREFS.quietFrom,
  quietTo: doc ? (doc.quietTo ?? null) : DEFAULT_NOTIFICATION_PREFS.quietTo,
  escalateMin: doc?.escalateMin ?? DEFAULT_NOTIFICATION_PREFS.escalateMin,
});

export const getPrefs = async (site: SiteDoc, user: { _id: unknown; email: string }): Promise<Prefs> =>
  toPrefs(await NotificationPrefs.findOne({ userId: user._id, siteId: site._id }).lean<NotificationPrefsDoc>(), user.email);

export const updatePrefs = async (site: SiteDoc, user: { _id: unknown; email: string }, role: Role, patch: NotificationPrefsPatch): Promise<Prefs> => {
  if (patch.failures === false && ALWAYS_FAILURES.includes(role))
    throw new HttpError(422, { error: { code: 422, message: 'Command failure emails are always on for owners and managers' } });
  const before = await getPrefs(site, user);
  const next = { ...before, ...patch };
  const doc = await NotificationPrefs.findOneAndUpdate({ userId: user._id, siteId: site._id }, { $set: next }, { upsert: true, new: true }).lean<NotificationPrefsDoc>();
  await recordAudit({ siteId: site._id, userId: String(user._id), action: 'notifications.update', target: `user:${user._id}`, before, after: next });
  return toPrefs(doc, user.email);
};
