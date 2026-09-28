import type { Env } from '../../config/env';
import { createSecrets } from '../../lib/secrets';
import type { ExplainDeps, LlmConfig } from './llm';

// The explanations setup from the environment (P5-05). A server default needs a key and, for an
// OpenAI-compatible API, a base URL and a model; Anthropic defaults to claude-opus-5.

export const serverLlmConfig = (env: Pick<Env, 'LLM_PROVIDER' | 'LLM_BASE_URL' | 'LLM_API_KEY' | 'ANTHROPIC_API_KEY' | 'LLM_MODEL'>): LlmConfig | string | null => {
  const provider = env.LLM_PROVIDER ?? (env.LLM_API_KEY ? 'openai-compatible' : env.ANTHROPIC_API_KEY ? 'anthropic' : null);
  if (!provider) return null;
  const apiKey = env.LLM_API_KEY ?? (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) return 'LLM_API_KEY is not set';
  if (provider === 'anthropic') return { provider, baseUrl: env.LLM_BASE_URL ?? null, model: env.LLM_MODEL ?? 'claude-opus-5', apiKey };
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) return 'an OpenAI-compatible model needs LLM_BASE_URL and LLM_MODEL';
  return { provider, baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey };
};

/** Explanations for the app, or a reason the server default is off (sites may still bring a key). */
export const explainDepsFromEnv = (env: Env): { deps: ExplainDeps; problem: string | null } => {
  const config = serverLlmConfig(env);
  return {
    deps: {
      server: config && typeof config === 'object' ? { config, monthlyTokens: env.LLM_SITE_MONTHLY_TOKENS } : null,
      secrets: env.SECRETS_KEY ? createSecrets(env.SECRETS_KEY) : undefined,
      allowPrivateUrls: env.LLM_ALLOW_PRIVATE_URLS,
    },
    problem: typeof config === 'string' ? config : null,
  };
};
