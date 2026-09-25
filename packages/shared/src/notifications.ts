import { z } from 'zod';
import { siteClock } from './time';

// Email notifications (plan P2-09, App v2 Settings → Notifications). Preferences are per person
// and site. Warnings wait until quiet hours end; command failures always send.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');

export const notificationPrefsPatch = z
  .object({
    email: z.string().trim().toLowerCase().email().max(200),
    alerts: z.boolean(),
    daily: z.boolean(),
    recs: z.boolean(),
    failures: z.boolean(),
    quietFrom: hhmm.nullable(),
    quietTo: hhmm.nullable(),
    escalateMin: z.number().int().min(5).max(24 * 60),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
  .refine((b) => (b.quietFrom === undefined) === (b.quietTo === undefined), { message: 'Set quiet hours from and to together', path: ['quietTo'] });
export type NotificationPrefsPatch = z.infer<typeof notificationPrefsPatch>;

export interface NotificationPrefs {
  email: string;
  alerts: boolean; // warnings and failures, as they happen
  daily: boolean; // yesterday's cost, peak and savings at 07:00
  recs: boolean; // new proposals (Phase 3)
  failures: boolean; // command failures: always on for owners and managers
  quietFrom: string | null; // local HH:mm; null = no quiet hours
  quietTo: string | null;
  escalateMin: number; // email the owner if an alert isn't acknowledged within this
}

export const DEFAULT_NOTIFICATION_PREFS: Omit<NotificationPrefs, 'email'> = {
  alerts: true,
  daily: true,
  recs: true,
  failures: true,
  quietFrom: '22:00',
  quietTo: '06:30',
  escalateMin: 30,
};

export const DAILY_SUMMARY_AT = '07:00';

/** Whether a local time falls in quiet hours; `from` after `to` wraps midnight (22:00–06:30). */
export const inQuietHours = (at: Date, tz: string, from: string | null, to: string | null): boolean => {
  if (!from || !to || from === to) return false;
  const t = siteClock(at, tz);
  return from < to ? t >= from && t < to : t >= from || t < to;
};
