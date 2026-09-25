import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import { connectDB } from './config/database';
import { loadEnv } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';

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

const app = createApp({ env, redis });

const server = app.listen(env.PORT, () => {
  logger.info(`Server running at http://localhost:${env.PORT}`);
});

process.on('SIGINT', () => {
  logger.info('Graceful shutdown initiated...');
  redis?.disconnect();
  server.close(() => process.exit(0));
});

export default app;
