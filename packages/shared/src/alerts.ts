import { z } from 'zod';

// Alerts (plan §2 `alerts`, P2-07). The rules service opens and auto-resolves them; people ack,
// snooze and resolve them through the Alerts API (P2-08).

// kind: 'condition' resolves itself when the condition clears; 'one-off' stays open with its
// condition cleared until someone closes it with a cause; 'event' is a single occurrence (counted).
export const ALERT_RULES = {
  'device-silent': { title: 'Device not reporting', severity: 'warning', kind: 'condition' },
  'pv-underperform': { title: 'Solar output below expected', severity: 'warning', kind: 'condition' },
  'battery-below-reserve': { title: 'Battery below reserve', severity: 'warning', kind: 'condition' },
  'demand-near-cap': { title: 'Demand close to the cap', severity: 'warning', kind: 'condition' },
  'command-ack-slow': { title: 'Command confirmed late', severity: 'info', kind: 'one-off' },
  'command-failed': { title: 'Command failed', severity: 'warning', kind: 'event' },
  'gateway-buffer': { title: 'Gateway holding old readings', severity: 'warning', kind: 'condition' },
} as const;

export type AlertRuleId = keyof typeof ALERT_RULES;
export const ALERT_RULE_IDS = Object.keys(ALERT_RULES) as AlertRuleId[];

export const ALERT_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATES = ['open', 'ack', 'resolved'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

/** What a check found: the condition holds for this rule and device (null: site-wide). */
export interface Finding {
  ruleId: AlertRuleId;
  deviceId: string | null;
  detail: string; // one line for the Inbox, e.g. "Inverter B at 78% of expected for 2 h"
  /** Event rules: one key per occurrence (the command id), so a repeat counts once. */
  eventKey?: string;
}

/** Key of one (rule, device) pair: an alert, a finding or an evaluated check. */
export const alertKey = (ruleId: AlertRuleId, deviceId: string | null): string => `${ruleId}|${deviceId ?? ''}`;

/**
 * The checks' output. `evaluated` lists the (rule, device) pairs a check could decide; an open
 * condition alert whose pair was evaluated but not found is resolved. Pairs not evaluated (no
 * fresh data, night-time for PV) leave their alerts as they are.
 */
export interface CheckResult {
  findings: Finding[];
  evaluated: string[];
}

export interface AlertView {
  id: string;
  siteId: string;
  deviceId: string | null;
  ruleId: AlertRuleId;
  severity: AlertSeverity;
  title: string;
  detail: string;
  state: AlertState;
  condition: 'active' | 'cleared';
  openedAt: string;
  lastSeenAt: string;
  count: number;
  resolvedAt: string | null;
}

// ---- thresholds (plan P2-07) ----------------------------------------------------------------------

export const ALERT_LIMITS = {
  silentMs: 5 * 60_000,
  pvRatio: 0.9, // of expected
  pvDaylightBuckets: 24, // 2 h of 5-minute daylight buckets
  pvClearBuckets: 12, // 1 h of daylight back within 5% of expected clears it
  pvClearRatio: 0.95,
  demandCapShare: 0.9,
  demandClearShare: 0.85,
  commandAckMs: 30_000,
  commandFailedWindowMs: 24 * 3600_000,
  gatewayBufferMs: 3600_000,
} as const;

// ---- Alerts API (P2-08, Backend Coverage §3) ------------------------------------------------------

/** Causes for closing an alert. Only `False alarm` may close one whose condition is still true. */
export const ALERT_CAUSES = ['Fixed on site', 'Known issue', 'Device replaced', 'False alarm'] as const;
export type AlertCause = (typeof ALERT_CAUSES)[number];

export const FALSE_ALARM_MUTE_DAYS = 7;
export const ALERT_SNOOZE_HOURS = 24;

export const resolveAlertBody = z.object({ cause: z.enum(ALERT_CAUSES), note: z.string().trim().max(1000).default('') }).strict();
export type ResolveAlertBody = z.infer<typeof resolveAlertBody>;

export const fixAlertBody = z.object({ fixId: z.string().min(1) }).strict();

export interface AlertDetail extends AlertView {
  deviceName: string | null;
  ackBy: { id: string; name: string } | null;
  ackAt: string | null;
  snoozedUntil: string | null;
  resolution: { cause: string; note: string; by: { id: string; name: string } | null; auto: boolean } | null;
  /** Remote fixes from the device profile, offered while the condition is true. */
  fixes: { id: string; label: string }[];
  /** Which buttons apply now (Backend Coverage §3). */
  actions: { ack: boolean; snooze: boolean; fix: boolean; resolve: boolean; falseAlarm: boolean };
}

/**
 * Which alert buttons apply (Backend Coverage §3): acknowledge while open; pause emails, remote fix
 * and false alarm while the condition is still true; resolve with a cause once it has cleared.
 */
export const alertActions = (a: Pick<AlertView, 'state' | 'condition'>, hasFix: boolean): AlertDetail['actions'] => {
  const live = a.state !== 'resolved';
  const active = live && a.condition === 'active';
  return { ack: a.state === 'open', snooze: active, fix: active && hasFix, resolve: live && a.condition === 'cleared', falseAlarm: active };
};
