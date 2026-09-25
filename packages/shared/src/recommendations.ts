// Recommendations (plan §2, P3-01): the rules service proposes device actions every 15 minutes;
// nothing reaches a device until someone approves (plan rule 9, Backend Coverage §2).

export const RECOMMENDATION_RULES = {
  'peak-shaving': { title: 'Peak shaving', device: 'battery' },
  'ev-offpeak': { title: 'EV off-peak', device: 'ev' },
  'ev-limit-near-cap': { title: 'EV limit near cap', device: 'ev' },
  'hp-precondition': { title: 'Heat pump pre-condition', device: 'heatpump' },
  'storm-reserve': { title: 'Storm reserve', device: 'battery' },
  'zero-export-low-price': { title: 'Zero export at low prices', device: 'pv' },
} as const;

export type RecommendationRuleId = keyof typeof RECOMMENDATION_RULES;
export const RECOMMENDATION_RULE_IDS = Object.keys(RECOMMENDATION_RULES) as RecommendationRuleId[];

/** Settings → Rules defaults (App v2). Money in cents, power in kW, times in minutes or hours. */
export const RULE_DEFAULTS = {
  'peak-shaving': { on: true, params: { socSchoolPct: 30, socOtherPct: 15, maxKw: 60, marginKw: 10 } },
  'ev-offpeak': { on: true, params: { bufferPct: 20, fleetOnly: true } },
  'ev-limit-near-cap': { on: true, params: { withinPct: 5, minA: 10 } },
  'hp-precondition': { on: true, params: { boostMin: 60, blockMin: 120 } },
  'storm-reserve': { on: false, params: { reservePct: 80, leadH: 12 } },
  'zero-export-low-price': { on: true, params: { belowCents: 0 } },
} as const satisfies Record<RecommendationRuleId, { on: boolean; params: Record<string, number | boolean> }>;

export type RuleParams<R extends RecommendationRuleId> = { -readonly [K in keyof (typeof RULE_DEFAULTS)[R]['params']]: (typeof RULE_DEFAULTS)[R]['params'][K] extends boolean ? boolean : number };

/** Site-wide approval settings (App v2 Settings → Rules → Approval). */
export const APPROVAL_WHO = ['owner-or-manager', 'owner'] as const;
export const APPROVAL_EMAIL = ['approvers', 'owner', 'nobody'] as const;
export interface ApprovalConfig {
  who: (typeof APPROVAL_WHO)[number];
  expireMin: number; // decide at least this long before the window starts
  email: (typeof APPROVAL_EMAIL)[number];
}
export const APPROVAL_DEFAULTS: ApprovalConfig = { who: 'owner-or-manager', expireMin: 15, email: 'approvers' };

export const RECOMMENDATION_STATUSES = ['proposed', 'approved', 'declined', 'expired', 'sent', 'acked', 'verified', 'failed', 'reverted', 'cancelled'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];
/** Still waiting for a decision or in progress: a new proposal with the same dedupeKey is skipped. */
export const OPEN_RECOMMENDATION_STATUSES: RecommendationStatus[] = ['proposed', 'approved', 'sent', 'acked'];

export interface Input {
  label: string;
  value: string;
}

export interface Check {
  text: string;
  pass: boolean;
}

/** What a rule proposes. The runner adds checks and saving from the rule's own functions. */
export interface Proposal {
  deviceId: string;
  action: string;
  params: Record<string, unknown>;
  window: { start: Date; end: Date };
  inputs: Input[];
  /** Rule + device + window: one open recommendation per key. */
  dedupeKey: string;
  title: string; // e.g. "Discharge battery at 30 kW, 14:00–17:00"
}

export const dedupeKeyOf = (ruleId: string, deviceId: string, window: { start: Date; end: Date }): string =>
  `${ruleId}|${deviceId}|${window.start.toISOString()}|${window.end.toISOString()}`;

/**
 * Start of the 15-minute slot containing `at`: rules run at :00, :15, :30 and :45 site time. Every
 * time zone is offset from UTC by a multiple of 15 minutes, so UTC quarters are site quarters.
 */
export const quarterOf = (at: Date): Date => new Date(Math.floor(at.getTime() / 900_000) * 900_000);
