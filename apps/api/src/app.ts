import express, { Express, NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Env } from './config/env';
import { logger as defaultLogger } from './config/logger';
import { corsMiddleware, helmetMiddleware, rateLimiter, requestLogger } from './middleware/security';
import basicRoutes from './modules/health/routes';
import authRoutes from './modules/auth/routes';
import { alertsRoutes } from './modules/alerts/routes';
import { devicesRoutes } from './modules/devices/routes';
import { recommendationsRoutes } from './modules/recommendations/routes';
import { commandsRoutes } from './modules/commands/routes';
import inboxRoutes from './modules/inbox/routes';
import auditRoutes from './modules/audit/routes';
import { inviteRoutes, siteInviteRoutes } from './modules/invites/routes';
import historyRoutes from './modules/history/routes';
import { exportsRoutes } from './modules/exports/routes';
import reportsRoutes, { reportLinkRoutes } from './modules/reports/routes';
import modelUploadRoutes from './modules/models/routes';
import peopleRoutes from './modules/people/routes';
import rulesRoutes from './modules/rules/routes';
import { siteRoutes } from './modules/site/routes';
import tariffRoutes from './modules/tariffs/routes';
import { billsRoutes } from './modules/bills/routes';
import { calendarRoutes } from './modules/calendar/routes';
import notificationRoutes from './modules/notifications/routes';
import forecastRoutes from './modules/forecast/routes';
import type { GatewayLink } from './lib/gatewayLink';
import type { JobClient } from './lib/jobs';
import type { ObjectStore } from '@ecomanage/db';
import type { SiteEventHub } from './lib/siteEvents';
import type { OsmLookup } from './modules/site/osm';
import type { CertSigner } from './modules/gateway/signer';
import type { ExplainDeps } from './modules/recommendations/explain';

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_MAX'>;
  redis?: Redis;
  hub?: SiteEventHub;
  logger?: Logger;
  sseHeartbeatMs?: number;
  /** Worker jobs (statements, utility bills, forecast reruns); absent without Redis. */
  jobs?: JobClient;
  /** Object storage for 3D models (P5-02); absent when not configured. */
  objects?: ObjectStore;
  /** MQTT to gateways (retained config); absent without a broker. */
  gateway?: GatewayLink;
  /** Building outlines from OpenStreetMap (P5-03); absent when turned off. */
  osm?: OsmLookup;
  /** Signs claimed gateways' certificates with the broker CA (P5-04); absent without the CA key. */
  signer?: CertSigner;
  /** Plain-language explanations of recommendations (P5-05); absent without a language model. */
  explain?: ExplainDeps;
}

export const createApp = ({ env, redis, hub, jobs, objects, gateway, osm, signer, explain, logger = defaultLogger, sseHeartbeatMs }: AppDeps): Express => {
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
    ['/api/auth/login', '/api/auth/refresh', '/api/invites'],
    rateLimiter({ windowMs: window, max: env.AUTH_RATE_LIMIT_MAX, prefix: 'rl:auth:', redis })
  );
  app.use('/api/auth', authRoutes);
  app.use('/api/alerts', alertsRoutes({ redis, gateway }));
  app.use('/api/devices', devicesRoutes(redis, gateway));
  app.use('/api/recommendations', recommendationsRoutes({ redis, explain }));
  app.use('/api/commands', commandsRoutes(redis));
  app.use('/api/inbox', inboxRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/site/invites', siteInviteRoutes(jobs));
  app.use('/api/site/model/uploads', modelUploadRoutes({ jobs, objects }));
  app.use('/api/site/members', peopleRoutes);
  app.use('/api/invites', inviteRoutes());
  app.use('/api/site', siteRoutes({ redis, hub, heartbeatMs: sseHeartbeatMs, gateway, jobs, osm, signer }));
  app.use('/api/tariffs', tariffRoutes);
  app.use('/api/bills', billsRoutes(jobs));
  app.use('/api/calendar', calendarRoutes(jobs));
  app.use('/api/me', notificationRoutes);
  app.use('/api/forecast', forecastRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/exports', exportsRoutes(jobs));
  app.use('/api/reports', reportsRoutes(jobs));
  app.use('/api/report-links', reportLinkRoutes());
  app.use('/api/rules', rulesRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 404, message: 'Not found' } });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    res.status(500).json({ error: { code: 500, message: 'There was an error serving your request.' } });
  });

  return app;
};
