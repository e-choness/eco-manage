import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Recommendation, type RecommendationDoc } from '@ecomanage/db';
import { OPEN_RECOMMENDATION_STATUSES, quarterOf, siteEventsChannel, type DemandNow, type Proposal, type SiteEvent } from '@ecomanage/shared';
import { loadRuleConfig } from './config';
import { loadRecContext } from './context';
import type { Rule } from './types';

// Every quarter hour, per site and enabled rule (Backend Coverage §2):
//   result = rule.evaluate(inputs) → null | Proposal (or several, one per device)
//   if result and no open recommendation with the same dedupeKey: insert it as "proposed",
//   expiring approve.expireMin before its window starts, and tell the Inbox.
// Rules only propose: nothing here talks to a device (plan rule 9).

export interface ProposeDeps {
  redis: Redis;
  logger: Logger;
  rules: Rule[];
  demand?: DemandNow | null;
}

export const proposeForSite = async (siteId: string, at: Date, deps: ProposeDeps): Promise<RecommendationDoc[]> => {
  const now = quarterOf(at);
  const config = await loadRuleConfig(siteId);
  const enabled = deps.rules.filter((r) => config.rules[r.id]?.on);
  if (!enabled.length) return [];
  const ctx = await loadRecContext(siteId, now, { redis: deps.redis, demand: deps.demand ?? null, approval: config.approval });
  if (!ctx) return [];

  const created: RecommendationDoc[] = [];
  for (const rule of enabled) {
    const params = config.rules[rule.id].params;
    let proposals: Proposal[];
    try {
      const result = rule.evaluate(ctx, params);
      proposals = result === null ? [] : Array.isArray(result) ? result : [result];
    } catch (err) {
      deps.logger.error({ siteId, ruleId: rule.id, err: (err as Error).message }, 'rule failed');
      continue;
    }
    for (const proposal of proposals) {
      const expiresAt = proposal.expiresAt ?? new Date(proposal.window.start.getTime() - config.approval.expireMin * 60_000);
      if (expiresAt <= now) continue; // no time left to decide
      if (await Recommendation.exists({ siteId, dedupeKey: proposal.dedupeKey, status: { $in: OPEN_RECOMMENDATION_STATUSES } })) continue;
      const checks = rule.check(ctx, proposal, params);
      const { cents, calc } = rule.saving(ctx, proposal, params);
      try {
        const [doc] = await Recommendation.create([
          {
            siteId,
            ruleId: rule.id,
            dedupeKey: proposal.dedupeKey,
            deviceId: proposal.deviceId,
            action: proposal.action,
            params: proposal.params,
            title: proposal.title,
            window: proposal.window,
            inputs: proposal.inputs,
            checks,
            calc,
            expectedSavingCents: cents,
            status: 'proposed',
            proposedAt: now,
            expiresAt,
          },
        ]);
        created.push(doc.toObject() as RecommendationDoc);
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // another rules process proposed it first
      }
    }
  }
  for (const r of created) {
    const event: SiteEvent = { type: 'inbox', itemType: 'decide', itemId: String(r._id) };
    await deps.redis.publish(siteEventsChannel(siteId), JSON.stringify(event));
    deps.logger.info({ siteId, ruleId: r.ruleId, deviceId: r.deviceId, title: r.title, savingCents: r.expectedSavingCents }, 'proposed');
  }
  return created;
};
