import express, { Express, NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Env } from './config/env';
import { logger as defaultLogger } from './config/logger';
import { corsMiddleware, helmetMiddleware, rateLimiter, requestLogger } from './middleware/security';
import basicRoutes from './modules/health/routes';
import authRoutes from './modules/auth/routes';
import alertRoutes from './modules/alerts/routes';
import { devicesRoutes } from './modules/devices/routes';
import optimizationRoutes from './modules/optimization/routes';
import { siteRoutes } from './modules/site/routes';
import tariffRoutes from './modules/tariffs/routes';
import { billsRoutes } from './modules/bills/routes';
import calendarRoutes from './modules/calendar/routes';
import type { GatewayLink } from './lib/gatewayLink';
import type { JobClient } from './lib/jobs';
import type { SiteEventHub } from './lib/siteEvents';

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_MAX'>;
  redis?: Redis;
  hub?: SiteEventHub;
  logger?: Logger;
  sseHeartbeatMs?: number;
  /** Worker jobs (statements, utility bills); absent without Redis. */
  jobs?: JobClient;
  /** MQTT to gateways (retained config); absent without a broker. */
  gateway?: GatewayLink;
}

export const createApp = ({ env, redis, hub, jobs, gateway, logger = defaultLogger, sseHeartbeatMs }: AppDeps): Express => {
  const app = express();
  const window = env.RATE_LIMIT_WINDOW_MS;

  // Behind the docker/nginx proxy the client IP comes from X-Forwarded-For.
  app.set('trust proxy', 1);
  app.enable('strict routing');
  app.use(helmetMiddleware());
  app.use(corsMiddleware(env.CORS_ORIGINS));
  app.use(requestLogger(logger));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(basicRoutes);
  app.use('/api', rateLimiter({ windowMs: window, max: env.RATE_LIMIT_MAX, prefix: 'rl:api:', redis }));
  app.use(
    ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'],
    rateLimiter({ windowMs: window, max: env.AUTH_RATE_LIMIT_MAX, prefix: 'rl:auth:', redis })
  );
  app.use('/api/auth', authRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/devices', devicesRoutes(redis));
  app.use('/api/optimization', optimizationRoutes);
  app.use('/api/site', siteRoutes({ redis, hub, heartbeatMs: sseHeartbeatMs, gateway }));
  app.use('/api/tariffs', tariffRoutes);
  app.use('/api/bills', billsRoutes(jobs));
  app.use('/api/calendar', calendarRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 404, message: 'Not found' } });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    res.status(500).json({ error: { code: 500, message: 'There was an error serving your request.' } });
  });

  return app;
};
