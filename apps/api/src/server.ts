import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { connectDB } from './config/database';
import { loadEnv } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';
import { overpassLookup } from './modules/site/osm';
import { receiveCsr } from './modules/gateway/claim';
import { signerFromFiles } from './modules/gateway/signer';
import Anthropic from '@anthropic-ai/sdk';
import { claudeExplainer } from './modules/recommendations/explain';
import { SiteEventHub } from './lib/siteEvents';
import { createJobClient } from './lib/jobs';
import { createObjectStore, objectStoreConfigFromEnv } from '@ecomanage/db';
import { createGatewayLink } from './lib/gatewayLink';
import { syncPendingGatewayConfigs } from './modules/site/settings';

dotenv.config();

let env;
try {
  env = loadEnv();
} catch (err) {
  logger.fatal((err as Error).message);
  process.exit(1);
}

const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 }) : undefined;
redis?.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
if (!redis) logger.warn('REDIS_URL not set: rate limits are per-process');

connectDB();

process.on('unhandledRejection', (err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: { message: error.message, stack: error.stack } }, 'unhandled rejection');
});

// Live events from ingest, forwarded to SSE clients (needs Redis).
const hub = redis ? new SiteEventHub(redis) : undefined;

// Statements and utility bills are handled by the worker (needs Redis).
const jobs = env.REDIS_URL ? createJobClient(env.REDIS_URL) : undefined;

// Gateway config (battery floor) over MQTT; anything that couldn't be sent goes out on connect.
const gateway = env.MQTT_URL ? createGatewayLink(env.MQTT_URL, env.MQTT_CERT_DIR) : undefined;
gateway?.onConnect(() => {
  syncPendingGatewayConfigs(gateway)
    .then((n) => n && logger.info({ sites: n }, 'sent pending gateway config'))
    .catch((err: Error) => logger.error({ err: err.message }, 'gateway config sync failed'));
});

// 3D model uploads (P5-02) go to S3-compatible storage when it is configured.
const storeConfig = objectStoreConfigFromEnv();
const objects = storeConfig ? createObjectStore(storeConfig) : undefined;

// Building outlines for the generated site model (P5-03).
const osm = env.OVERPASS_URL ? overpassLookup(env.OVERPASS_URL) : undefined;

// Claiming gateways (P5-04): certificates are signed with the broker's CA and sent back over
// the bootstrap connection.
const signer = signerFromFiles(`${env.MQTT_CERT_DIR}/ca.crt`, env.MQTT_CA_KEY ?? `${env.MQTT_CERT_DIR}/ca.key`);
if (gateway && !signer) logger.warn('No CA key: gateways can be claimed but not certified until it is available');
gateway?.onClaimRequest?.((serial, payload) => {
  receiveCsr({ gateway, signer, logger }, serial, payload).catch((err: Error) => logger.error({ err: err.message, serial }, 'certificate request failed'));
});

// Explanations of recommendations (P5-05) when an Anthropic API key is set.
const explain = env.ANTHROPIC_API_KEY
  ? { explainer: claudeExplainer(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.LLM_MODEL), monthlyTokens: env.LLM_SITE_MONTHLY_TOKENS }
  : undefined;

const app = createApp({ env, redis, hub, jobs, objects, gateway, osm, signer, explain });

const server = app.listen(env.PORT, () => {
  logger.info(`Server running at http://localhost:${env.PORT}`);
});

process.on('SIGINT', () => {
  logger.info('Graceful shutdown initiated...');
  void hub?.close();
  void jobs?.close();
  void gateway?.close();
  redis?.disconnect();
  server.close(() => process.exit(0));
});

export default app;
