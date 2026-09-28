import { Site, recordAudit, type SiteDoc } from '@ecomanage/db';
import type { ExplanationSettingsInput, ExplanationSettingsView, ExplanationTestResult, LlmProvider } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import { used } from '../recommendations/explain';
import { baseUrlProblem, explainerFor, type ExplainDeps, type LlmConfig } from '../recommendations/llm';

// Settings → Rules → Explanations (owner, P5-05): plug in a language model for this site with
// the owner's own key, from any OpenAI-compatible provider or Anthropic. The key is sealed at rest
// and never sent back; only its last four characters are shown.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

const hint = (key: string) => `…${key.slice(-4)}`;

export const explanationSettings = async (deps: ExplainDeps | undefined, site: SiteDoc, now = new Date()): Promise<ExplanationSettingsView> => {
  const own = site.explanations?.keyEnc ? site.explanations : null;
  const server = deps?.server ?? null;
  const base = { usedTokens: await used(site, now), canStoreKeys: !!deps?.secrets, updatedAt: own?.updatedAt?.toISOString() ?? null };
  if (own && deps?.secrets)
    return { source: 'site', provider: own.provider as LlmProvider, baseUrl: own.baseUrl ?? null, model: own.model ?? null, keyHint: own.keyHint ?? null, monthlyTokens: own.monthlyTokens ?? 200_000, ...base };
  if (server) return { source: 'server', provider: server.config.provider, baseUrl: null, model: server.config.model, keyHint: null, monthlyTokens: server.monthlyTokens, ...base };
  return { source: 'none', provider: null, baseUrl: null, model: null, keyHint: null, monthlyTokens: 0, ...base };
};

const checkUrl = (deps: ExplainDeps | undefined, url: string) => {
  const problem = baseUrlProblem(url, deps?.allowPrivateUrls);
  if (problem) throw fail(400, problem);
};

/** Saves the site's own model. A key left out keeps the saved one. */
export const saveExplanationSettings = async (deps: ExplainDeps | undefined, site: SiteDoc, userId: string, input: ExplanationSettingsInput): Promise<ExplanationSettingsView> => {
  if (!deps?.secrets) throw fail(503, 'This server can’t keep API keys yet (SECRETS_KEY isn’t set).');
  checkUrl(deps, input.baseUrl);
  const before = site.explanations?.keyEnc ? site.explanations : null;
  if (!input.apiKey && !before) throw fail(400, 'Enter the API key.');
  const explanations = {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    keyEnc: input.apiKey ? deps.secrets.seal(input.apiKey) : before!.keyEnc,
    keyHint: input.apiKey ? hint(input.apiKey) : before!.keyHint,
    monthlyTokens: input.monthlyTokens,
    updatedAt: new Date(),
    updatedBy: userId,
  };
  await Site.updateOne({ _id: site._id }, { $set: { explanations } });
  const safe = (e: { provider?: string | null; baseUrl?: string | null; model?: string | null; keyHint?: string | null; monthlyTokens?: number | null } | null) =>
    e ? { provider: e.provider, baseUrl: e.baseUrl, model: e.model, keyHint: e.keyHint, monthlyTokens: e.monthlyTokens } : null;
  await recordAudit({ siteId: site._id, userId, action: 'site.explanations', target: `site:${site._id}`, before: safe(before), after: safe(explanations) });
  return explanationSettings(deps, (await Site.findById(site._id).lean<SiteDoc>())!);
};

/** Back to the server's default (or off): the site's key is forgotten. */
export const removeExplanationSettings = async (deps: ExplainDeps | undefined, site: SiteDoc, userId: string): Promise<ExplanationSettingsView> => {
  if (site.explanations) {
    await Site.updateOne({ _id: site._id }, { $set: { explanations: null } });
    await recordAudit({ siteId: site._id, userId, action: 'site.explanations', target: `site:${site._id}`, before: { provider: site.explanations.provider, model: site.explanations.model, keyHint: site.explanations.keyHint }, after: null });
  }
  return explanationSettings(deps, (await Site.findById(site._id).lean<SiteDoc>())!);
};

// A tiny request with nothing from the site in it.
const PING = { rule: { id: 'test', title: 'Connection test' }, device: { type: 'battery' }, action: 'test', settings: {}, window: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', timeZone: 'UTC' }, checks: [], calculation: '', expectedSaving: { amount: 0, currency: 'USD' } };

/** Tries the settings given (before saving) or the saved ones. Spends a few tokens; not counted. */
export const testExplanationSettings = async (deps: ExplainDeps | undefined, site: SiteDoc, input: Partial<ExplanationSettingsInput> | undefined): Promise<ExplanationTestResult> => {
  const own = site.explanations?.keyEnc ? site.explanations : null;
  let config: LlmConfig;
  if (input?.provider && input.baseUrl && input.model) {
    checkUrl(deps, input.baseUrl);
    const apiKey = input.apiKey ?? (own && deps?.secrets ? deps.secrets.open(own.keyEnc!) : null);
    if (!apiKey) throw fail(400, 'Enter the API key.');
    config = { provider: input.provider, baseUrl: input.baseUrl, model: input.model, apiKey };
  } else if (own && deps?.secrets) {
    config = { provider: own.provider as LlmProvider, baseUrl: own.baseUrl ?? null, model: own.model!, apiKey: deps.secrets.open(own.keyEnc!) };
  } else throw fail(400, 'Nothing to test: fill in the settings first.');
  const started = Date.now();
  try {
    const r = await (deps?.explainerFor ?? explainerFor)(config)(PING);
    return { ok: true, model: r.model, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    const message = err instanceof HttpError ? String((err.body.error as { message?: string })?.message ?? err.message) : 'The language model couldn’t be reached.';
    return { ok: false, model: null, latencyMs: Date.now() - started, error: message };
  }
};
