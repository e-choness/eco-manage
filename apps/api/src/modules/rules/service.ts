import { Recommendation, RuleConfig, recordAudit, type RuleConfigDoc, type SiteDoc } from '@ecomanage/db';
import { APPROVAL_RULE_ID, resolveRuleConfig } from '@ecomanage/recs';
import {
  RECOMMENDATION_RULES,
  RECOMMENDATION_RULE_IDS,
  RULE_DEFAULTS,
  type ApprovalPatch,
  type RecommendationRuleId,
  type RulePatch,
  type RulesResponse,
} from '@ecomanage/shared';
import { HttpError } from '../../lib/http';

// Settings → Rules (P4-08): each rule on or off with its limits, and who approves. The rules
// service reads these on every run, so a change applies from the next quarter hour.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });
const DECLINE_WINDOW_MS = 30 * 86_400_000;

export const listRules = async (site: SiteDoc, now = new Date()): Promise<RulesResponse> => {
  const [docs, declines] = await Promise.all([
    RuleConfig.find({ siteId: site._id }).lean<RuleConfigDoc[]>(),
    Recommendation.aggregate<{ _id: { ruleId: string; reason: string }; n: number }>([
      { $match: { siteId: site._id, status: 'declined', decidedAt: { $gte: new Date(now.getTime() - DECLINE_WINDOW_MS) } } },
      { $group: { _id: { ruleId: '$ruleId', reason: '$declineReason' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
  ]);
  const cfg = resolveRuleConfig(docs);
  return {
    approval: cfg.approval,
    rules: RECOMMENDATION_RULE_IDS.map((id) => {
      const mine = declines.filter((d) => d._id.ruleId === id);
      return {
        id,
        title: RECOMMENDATION_RULES[id].title,
        device: RECOMMENDATION_RULES[id].device,
        on: cfg.rules[id].on,
        params: cfg.rules[id].params,
        defaults: { on: RULE_DEFAULTS[id].on, params: { ...RULE_DEFAULTS[id].params } },
        declines30d: { count: mine.reduce((s, d) => s + d.n, 0), reasons: mine.slice(0, 3).map((d) => ({ reason: d._id.reason ?? '—', count: d.n })) },
      };
    }),
  };
};

const save = async (site: SiteDoc, userId: string, ruleId: string, set: { on?: boolean; params?: Record<string, unknown> }) => {
  const before = await RuleConfig.findOne({ siteId: site._id, ruleId }).lean<RuleConfigDoc>();
  const params = { ...((before?.params as Record<string, unknown>) ?? {}), ...(set.params ?? {}) };
  await RuleConfig.updateOne(
    { siteId: site._id, ruleId },
    { $set: { ...(set.on !== undefined ? { on: set.on } : {}), params, updatedBy: userId } },
    { upsert: true }
  );
  await recordAudit({ siteId: site._id, userId, action: 'rule.update', target: `rule:${ruleId}`, before: before ? { on: before.on, params: before.params } : null, after: set });
};

/** A recommendation rule: params must be ones the rule has, of the same kind (number or yes/no). */
export const updateRule = async (site: SiteDoc, userId: string, ruleId: string, patch: RulePatch): Promise<RulesResponse> => {
  if (!RECOMMENDATION_RULE_IDS.includes(ruleId as RecommendationRuleId)) throw fail(404, 'Unknown rule');
  const defaults: Record<string, number | boolean> = RULE_DEFAULTS[ruleId as RecommendationRuleId].params;
  for (const [k, v] of Object.entries(patch.params ?? {})) {
    if (!(k in defaults)) throw fail(400, `${k} is not a setting of this rule`);
    if (typeof v !== typeof defaults[k]) throw fail(400, `${k} must be ${typeof defaults[k] === 'boolean' ? 'on or off' : 'a number'}`);
    if (typeof v === 'number' && v < 0 && k !== 'belowCents') throw fail(400, `${k} can't be negative`);
  }
  await save(site, userId, ruleId, patch);
  return listRules(site);
};

export const updateApproval = async (site: SiteDoc, userId: string, patch: ApprovalPatch): Promise<RulesResponse> => {
  await save(site, userId, APPROVAL_RULE_ID, patch);
  return listRules(site);
};
