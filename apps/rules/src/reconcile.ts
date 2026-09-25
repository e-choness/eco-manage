import { Alert, RuleMute, type AlertDoc, type RuleMuteDoc } from '@ecomanage/db';
import { ALERT_RULES, alertKey, type AlertRuleId, type AlertView, type CheckResult } from '@ecomanage/shared';

// Findings → alerts (plan P2-07): at most one open or acked alert per (site, device, rule).
// Condition alerts resolve themselves when their check runs and no longer finds the condition;
// event alerts (a failed command) stay open until a person resolves them and count repeats.
// A mute (false alarm, P2-08) stops new alerts for its rule and device until it ends.

const MAX_EVENT_KEYS = 20;

export const toView = (a: AlertDoc): AlertView => ({
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

const isMuted = (mutes: RuleMuteDoc[], ruleId: string, deviceId: string | null) =>
  mutes.some((m) => m.ruleId === ruleId && (m.deviceId == null || m.deviceId === deviceId));

/** Alerts open or acked for the site, by key. */
export const liveAlerts = async (siteId: string): Promise<Map<string, AlertDoc>> => {
  const docs = await Alert.find({ siteId, state: { $in: ['open', 'ack'] } }).lean<AlertDoc[]>();
  return new Map(docs.map((a) => [alertKey(a.ruleId as AlertRuleId, a.deviceId ?? null), a]));
};

/**
 * Applies one evaluation to the site's alerts. Returns the alerts that were opened, resolved or
 * counted again, for the live stream.
 */
export const reconcile = async (siteId: string, result: CheckResult, now: Date, live?: Map<string, AlertDoc>): Promise<AlertView[]> => {
  const current = live ?? (await liveAlerts(siteId));
  const mutes = await RuleMute.find({ siteId, until: { $gt: now } }).lean<RuleMuteDoc[]>();
  const changed: AlertDoc[] = [];
  const found = new Set<string>();

  for (const f of result.findings) {
    const key = alertKey(f.ruleId, f.deviceId);
    found.add(key);
    const rule = ALERT_RULES[f.ruleId];
    const existing = current.get(key);

    if (existing) {
      if (rule.kind === 'event') {
        if (!f.eventKey || existing.eventKeys?.includes(f.eventKey)) continue;
        const updated = await Alert.findOneAndUpdate(
          { _id: existing._id, eventKeys: { $ne: f.eventKey } },
          { $inc: { count: 1 }, $set: { lastSeenAt: now, detail: f.detail }, $push: { eventKeys: { $each: [f.eventKey], $slice: -MAX_EVENT_KEYS } } },
          { new: true }
        ).lean<AlertDoc>();
        if (updated) changed.push(updated);
      } else {
        // Still active: keep it fresh; not worth a stream event.
        await Alert.updateOne({ _id: existing._id }, { $set: { lastSeenAt: now, detail: f.detail, condition: 'active' } });
      }
      continue;
    }

    if (isMuted(mutes, f.ruleId, f.deviceId)) continue;
    // An occurrence someone already resolved doesn't come back.
    if (rule.kind === 'event' && f.eventKey && (await Alert.exists({ siteId, ruleId: f.ruleId, deviceId: f.deviceId, eventKeys: f.eventKey }))) continue;
    try {
      const [created] = await Alert.create([
        {
          siteId,
          deviceId: f.deviceId,
          ruleId: f.ruleId,
          severity: rule.severity,
          title: rule.title,
          detail: f.detail,
          state: 'open',
          condition: rule.kind === 'event' ? 'cleared' : 'active',
          openedAt: now,
          lastSeenAt: now,
          count: 1,
          eventKeys: f.eventKey ? [f.eventKey] : [],
        },
      ]);
      changed.push(created.toObject() as AlertDoc);
    } catch (err) {
      // Another rules process opened it first (unique live-alert index).
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  const evaluated = new Set(result.evaluated);
  for (const [key, a] of current) {
    if (found.has(key) || !evaluated.has(key) || ALERT_RULES[a.ruleId as AlertRuleId]?.kind !== 'condition') continue;
    const resolved = await Alert.findOneAndUpdate(
      { _id: a._id, state: { $in: ['open', 'ack'] } },
      { $set: { state: 'resolved', condition: 'cleared', resolvedAt: now, resolution: { cause: 'Condition cleared', note: '', by: null, auto: true } } },
      { new: true }
    ).lean<AlertDoc>();
    if (resolved) changed.push(resolved);
  }

  return changed.map(toView);
};
