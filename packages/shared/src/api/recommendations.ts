import { z } from 'zod';
import type { Check, Input, RecommendationStatus } from '../recommendations';

// Recommendations API (plan P3-03, Backend Coverage §2 and §4).

export interface RecommendationView {
  id: string;
  ruleId: string; // a rule id, or "manual"
  ruleTitle: string;
  deviceId: string;
  deviceName: string | null;
  action: string;
  params: Record<string, unknown>;
  title: string;
  window: { start: string; end: string };
  expectedSavingCents: number;
  status: RecommendationStatus;
  proposedAt: string;
  expiresAt: string;
}

export interface RecommendationDetail extends RecommendationView {
  inputs: Input[];
  checks: Check[];
  calc: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  declineReason: string | null;
  commandId: string | null;
  /** What approving sends to the gateway (App v2 "payload"). */
  payload: { deviceId: string; action: string; params: Record<string, unknown>; expiresAt: string; revertAt: string | null };
  /** Whether the signed-in person may approve it (Settings → Rules → Who can approve). */
  canApprove: boolean;
}

const window = z
  .object({ start: z.coerce.date(), end: z.coerce.date() })
  .strict()
  .refine((w) => w.start < w.end, { message: 'The window must end after it starts', path: ['end'] });

/** POST /api/recommendations: a manual request from the Devices page. */
export const manualRecommendationBody = z
  .object({ deviceId: z.string().min(1), action: z.string().min(1), params: z.record(z.unknown()).default({}), window })
  .strict();
export type ManualRecommendationBody = z.infer<typeof manualRecommendationBody>;

/** POST /:id/check and /:id/approve: the action as adjusted in the Inbox (e.g. the kW slider). */
export const adjustRecommendationBody = z.object({ params: z.record(z.unknown()).optional() }).strict();

export const declineRecommendationBody = z.object({ reason: z.string().trim().min(3, 'Say why, so the rule can be tuned').max(500) }).strict();

// ---- commands (P3-04) ---------------------------------------------------------------------------

export const COMMAND_STATUSES = ['created', 'sent', 'acked', 'failed', 'verified', 'reverted', 'cancelled'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface CommandView {
  id: string;
  deviceId: string;
  deviceName: string | null;
  action: string;
  params: Record<string, unknown>;
  status: CommandStatus;
  sendAt: string | null;
  sentAt: string | null;
  ackedAt: string | null;
  verifiedAt: string | null;
  failedAt: string | null;
  error: string | null;
  expiresAt: string;
  revertAt: string | null;
  revertedAt: string | null;
  cancelledAt: string | null;
  recommendation: { id: string; title: string } | null;
  /** The revert command, once there is one. */
  revert: { id: string; action: string; status: CommandStatus } | null;
}
