import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { Site, initModels } from '@ecomanage/db';
import { quarterOf, type SiteEvent } from '@ecomanage/shared';
import { RulesService } from './service';
import { CommandDispatcher } from './commands/dispatcher';
import { createCommandLink } from './commands/link';
import { RULES, expireRecommendations, proposeForSite } from '@ecomanage/recs';

const siteIds = async () => (await Site.find().select('_id').lean()).map((s) => String(s._id));

const env = z
  .object({
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    LOG_LEVEL: z.string().default('info'),
    RULES_TICK_MS: z.coerce.number().int().positive().default(2000),
    RULES_SWEEP_MS: z.coerce.number().int().positive().default(15_000),
    MQTT_URL: z.string().optional(),
    MQTT_CERT_DIR: z.string().default('/repo/infra/mosquitto/certs'),
  })
  .parse(process.env);

const log = pino({ level: env.LOG_LEVEL });

const main = async () => {
  await mongoose.connect(env.DATABASE_URL);
  await initModels();
  const redis = new Redis(env.REDIS_URL);
  const sub = redis.duplicate();
  const rules = new RulesService({ redis, logger: log, minGapMs: env.RULES_TICK_MS });

  // Every reading ingest stores is published on site:{id}:events.
  await sub.psubscribe('site:*:events');
  sub.on('pmessage', (_pattern, channel, message) => {
    const siteId = channel.split(':')[1];
    try {
      rules.onEvent(siteId, JSON.parse(message) as SiteEvent);
    } catch {
      // not ours to judge; ingest validates what it publishes
    }
  });

  // Commands go out over MQTT as the svc-rules identity (P3-04). Without a broker nothing is sent.
  const link = env.MQTT_URL ? createCommandLink(env.MQTT_URL, env.MQTT_CERT_DIR) : null;
  if (!link) log.warn('MQTT_URL not set: approved commands are not sent');
  const dispatcher = link ? new CommandDispatcher({ redis, link, logger: log }) : null;

  // One loop, so a site is never evaluated twice at once: new readings every tick, every site on
  // the sweep for the time-based checks, and the recommendation rules once per quarter hour.
  let lastSweep = 0;
  let lastQuarter = quarterOf(new Date()).getTime(); // the first proposals come at the next :00/:15/:30/:45
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      const now = new Date();
      const quarter = quarterOf(now).getTime();
      if (quarter > lastQuarter) {
        lastQuarter = quarter;
        for (const siteId of await siteIds())
          await proposeForSite(siteId, now, { redis, logger: log, rules: RULES, demand: rules.demandOf(siteId) ?? undefined }).catch((err: Error) =>
            log.error({ siteId, err: err.message }, 'recommendation run failed')
          );
      } else if (now.getTime() - lastSweep >= env.RULES_SWEEP_MS) {
        lastSweep = now.getTime();
        await rules.runAll(await siteIds(), now);
        const expired = await expireRecommendations(redis, now);
        if (expired) log.info({ expired }, 'proposals expired');
      } else {
        await rules.runDirty(now);
      }
      await dispatcher?.tick(now).catch((err: Error) => log.error({ err: err.message }, 'command dispatch failed'));
      await new Promise((r) => setTimeout(r, env.RULES_TICK_MS));
    }
  };
  log.info('rules ready');
  void loop().catch((err: Error) => {
    log.fatal({ err: err.message }, 'rules loop stopped');
    process.exit(1);
  });

  const stop = async () => {
    stopped = true;
    await link?.close();
    sub.disconnect();
    redis.disconnect();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
};

main().catch((err) => {
  log.fatal({ err: err.message }, 'rules failed to start');
  process.exit(1);
});
