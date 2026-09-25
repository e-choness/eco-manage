import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { connectDB } from './config/database';
import { loadEnv } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';
import { SiteEventHub } from './lib/siteEvents';
import { createJobClient } from './lib/jobs';
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

const app = createApp({ env, redis, hub, jobs, gateway });

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
