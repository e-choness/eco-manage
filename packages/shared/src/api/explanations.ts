import { z } from 'zod';

// Who writes the plain-language explanations of recommendations (P5-05): the server's default
// provider, or one the site's owner plugs in with their own key. Any OpenAI-compatible endpoint
// works (a `/chat/completions` API), as does Anthropic's own.

export const LLM_PROVIDERS = ['openai-compatible', 'anthropic'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Where a key comes from, to fill the form in; the model is the owner's choice. */
export const LLM_PRESETS = [
  { id: 'openai', label: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', provider: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'together', label: 'Together AI', provider: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', provider: 'openai-compatible', baseUrl: '' },
] as const satisfies readonly { id: string; label: string; provider: LlmProvider; baseUrl: string }[];

/** PUT /api/site/explanations (owner). Leave `apiKey` out to keep the saved one. */
export const explanationSettingsInput = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    baseUrl: z.string().trim().url('Enter the API’s base URL, like https://api.openai.com/v1').max(300),
    model: z.string().trim().min(1, 'Enter a model name').max(120),
    apiKey: z.string().trim().min(8, 'That doesn’t look like an API key').max(400).optional(),
    monthlyTokens: z.number().int().min(1000).max(100_000_000),
  })
  .strict();
export type ExplanationSettingsInput = z.infer<typeof explanationSettingsInput>;

/** POST /api/site/explanations/test (owner): the saved settings, or these before saving them. */
export const explanationTestInput = explanationSettingsInput.partial({ monthlyTokens: true }).optional();

/** GET /api/site/explanations. The key itself never leaves the server. */
export interface ExplanationSettingsView {
  /** Who writes them for this site: its own provider, the server's default, or nobody (off). */
  source: 'site' | 'server' | 'none';
  provider: LlmProvider | null;
  baseUrl: string | null;
  model: string | null;
  keyHint: string | null; // "…a1b2" for a site's own key
  monthlyTokens: number;
  usedTokens: number; // this month
  /** Whether this server can keep a site's key (it has SECRETS_KEY). */
  canStoreKeys: boolean;
  updatedAt: string | null;
}

export interface ExplanationTestResult {
  ok: boolean;
  model: string | null;
  latencyMs: number;
  error: string | null;
}
