import { RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { Store } from 'express-rate-limit';
import { RedisStore, RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export const corsMiddleware = (origins: string[]): RequestHandler =>
  cors({
    // Requests without an Origin header (curl, server-to-server, same-origin) are allowed;
    // browser requests must come from the allow-list.
    origin: (origin, callback) => callback(null, !origin || origins.includes(origin)),
    credentials: true,
  });

export const helmetMiddleware = (): RequestHandler => helmet();

const redisStore = (redis: Redis, prefix: string): Store =>
  new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  prefix: string;
  redis?: Redis;
}

export const rateLimiter = ({ windowMs, max, prefix, redis }: RateLimitOptions): RequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: redis ? redisStore(redis, prefix) : undefined,
    message: { error: { code: 429, message: 'Too many requests, try again later.' } },
  });

// Logs method, path, status and duration only. Headers, bodies and query strings are
// never logged, so tokens and passwords can't leak into the logs.
export const requestLogger =
  (logger: Logger): RequestHandler =>
  (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split('?')[0];
      logger.info({ method: req.method, path, status: res.statusCode, ms: Math.round(ms) }, 'request');
    });
    next();
  };
