import { RuleConfig, type RuleConfigDoc } from '@ecomanage/db';
import { APPROVAL_DEFAULTS, RECOMMENDATION_RULE_IDS, RULE_DEFAULTS, type ApprovalConfig, type RecommendationRuleId } from '@ecomanage/shared';

// Settings → Rules for a site: the App v2 defaults, overridden by what the site saved.

export interface SiteRuleConfig {
  rules: Record<RecommendationRuleId, { on: boolean; params: Record<string, number | boolean> }>;
  approval: ApprovalConfig;
}

export const APPROVAL_RULE_ID = 'approval';

export const resolveRuleConfig = (docs: Pick<RuleConfigDoc, 'ruleId' | 'on' | 'params'>[]): SiteRuleConfig => {
  const byId = new Map(docs.map((d) => [d.ruleId, d]));
  const rules = {} as SiteRuleConfig['rules'];
  for (const id of RECOMMENDATION_RULE_IDS) {
    const saved = byId.get(id);
    const defaults: Record<string, number | boolean> = RULE_DEFAULTS[id].params;
    rules[id] = { on: saved?.on ?? RULE_DEFAULTS[id].on, params: { ...defaults, ...((saved?.params as Record<string, number | boolean>) ?? {}) } };
  }
  const approval = { ...APPROVAL_DEFAULTS, ...((byId.get(APPROVAL_RULE_ID)?.params as Partial<ApprovalConfig>) ?? {}) };
  return { rules, approval };
};

export const loadRuleConfig = async (siteId: string): Promise<SiteRuleConfig> =>
  resolveRuleConfig(await RuleConfig.find({ siteId }).lean<RuleConfigDoc[]>());
