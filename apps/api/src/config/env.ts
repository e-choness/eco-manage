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
  // Plain-language explanations of recommendations (P5-05): on when an Anthropic API key is set.
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_SITE_MONTHLY_TOKENS: z.coerce.number().int().nonnegative().default(200_000),
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
