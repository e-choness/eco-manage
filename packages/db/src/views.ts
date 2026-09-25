import type { AlertRuleId, AlertView } from '@ecomanage/shared';
import type { AlertDoc } from './models';

/** An alert as the API and the live stream show it (shared by apps/rules and apps/api). */
export const alertView = (a: AlertDoc): AlertView => ({
  id: String(a._id),
  siteId: String(a.siteId),
  deviceId: a.deviceId ?? null,
  ruleId: a.ruleId as AlertRuleId,
  severity: a.severity as AlertView['severity'],
  title: a.title,
  detail: a.detail ?? '',
  state: a.state as AlertView['state'],
  condition: a.condition as AlertView['condition'],
  openedAt: a.openedAt.toISOString(),
  lastSeenAt: a.lastSeenAt.toISOString(),
  count: a.count ?? 1,
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
});
