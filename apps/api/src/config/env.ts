import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );

// Compose passes an unset variable as an empty string: treat it as not set.
const unset = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  REFRESH_TOKEN_SECRET: z.string().min(1),
  // Comma-separated list of origins allowed to call the API with credentials.
  CORS_ORIGINS: csv,
  // Without REDIS_URL the rate limiter falls back to an in-process store (single instance only).
  REDIS_URL: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // MQTT to gateways (svc-api certificate). Without it, gateway config is queued as pending.
  MQTT_URL: z.string().optional(),
  MQTT_CERT_DIR: z.string().default('/repo/infra/mosquitto/certs'),
  // The CA key that signs claimed gateways' certificates (P5-04); default MQTT_CERT_DIR/ca.key.
  MQTT_CA_KEY: z.string().optional(),
  // Overpass API for building outlines (Settings → Site model, P5-03); empty turns the lookup off.
  OVERPASS_URL: z.string().default('https://overpass-api.de/api/interpreter'),
  // Plain-language explanations of recommendations (P5-05). The server's default model: any
  // OpenAI-compatible API (LLM_PROVIDER=openai-compatible with LLM_BASE_URL, LLM_API_KEY and
  // LLM_MODEL), or Anthropic (LLM_PROVIDER=anthropic with LLM_API_KEY, or just ANTHROPIC_API_KEY).
  // Sites can plug in their own key in Settings when SECRETS_KEY is set.
  LLM_PROVIDER: unset(z.enum(['openai-compatible', 'anthropic'])),
  LLM_BASE_URL: unset(z.string().url()),
  LLM_API_KEY: unset(z.string()),
  ANTHROPIC_API_KEY: unset(z.string()),
  LLM_MODEL: unset(z.string()),
  LLM_SITE_MONTHLY_TOKENS: z.coerce.number().int().nonnegative().default(200_000),
  LLM_ALLOW_PRIVATE_URLS: z.stringbool().default(false),
  // Seals secrets the API keeps (a site's own model key). Long and random; changing it forgets them.
  SECRETS_KEY: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  return parsed.data;
};
