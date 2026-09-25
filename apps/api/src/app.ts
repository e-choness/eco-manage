import express, { Express, NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Env } from './config/env';
import { logger as defaultLogger } from './config/logger';
import { corsMiddleware, helmetMiddleware, rateLimiter, requestLogger } from './middleware/security';
import basicRoutes from './routes/index';
import authRoutes from './routes/authRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import alertRoutes from './routes/alertRoutes';
import deviceRoutes from './routes/deviceRoutes';
import financialRoutes from './routes/financialRoutes';
import optimizationRoutes from './routes/optimizationRoutes';

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_MAX'>;
  redis?: Redis;
  logger?: Logger;
}

export const createApp = ({ env, redis, logger = defaultLogger }: AppDeps): Express => {
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
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/financial', financialRoutes);
  app.use('/api/optimization', optimizationRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 404, message: 'Not found' } });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    res.status(500).json({ error: { code: 500, message: 'There was an error serving your request.' } });
  });

  return app;
};
