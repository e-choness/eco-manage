import { z } from 'zod';
import { APPROVAL_EMAIL, APPROVAL_WHO, type ApprovalConfig, type RecommendationRuleId } from '../recommendations';

// Settings → Rules (Backend Coverage: GET /api/rules, PATCH /api/rules/:ruleId, P4-08). Everyone
// reads; owners and managers change. The rules service reads the saved values on every run.

export interface RuleView {
  id: RecommendationRuleId;
  title: string;
  device: string;
  on: boolean;
  params: Record<string, number | boolean>;
  defaults: { on: boolean; params: Record<string, number | boolean> };
  /** Declines in the last 30 days and their most common reasons, to tune the rule. */
  declines30d: { count: number; reasons: { reason: string; count: number }[] };
}

export interface RulesResponse {
  approval: ApprovalConfig;
  rules: RuleView[];
}

/** PATCH /api/rules/:ruleId for a recommendation rule. Params are checked against its defaults. */
export const rulePatch = z
  .object({ on: z.boolean(), params: z.record(z.string(), z.union([z.number().finite().min(-1000).max(100_000), z.boolean()])) })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type RulePatch = z.infer<typeof rulePatch>;

/** PATCH /api/rules/approval. */
export const approvalPatch = z
  .object({
    params: z
      .object({ who: z.enum(APPROVAL_WHO), expireMin: z.number().int().min(0).max(240), email: z.enum(APPROVAL_EMAIL) })
      .partial()
      .strict()
      .refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
  })
  .strict();
export type ApprovalPatch = z.infer<typeof approvalPatch>;
