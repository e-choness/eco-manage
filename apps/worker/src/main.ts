import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { initModels } from '@ecomanage/db';
import { QUEUES } from '@ecomanage/shared';
import { costPendingIntervals, nightlyBills } from './billing';
import { statementJob, utilityBillJob } from './documents';
import { createMailer } from './email/mailer';
import { dailySummaries, notifyAlerts, notifyProposals } from './email/notify';
import { forecastAll, forecastSite } from './forecast/run';
import { openMeteoWeather, simulatedWeather } from './forecast/weather';

const env = z
  .object({
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    LOG_LEVEL: z.string().default('info'),
    COST_EVERY_MS: z.coerce.number().int().positive().default(60_000),
    SMTP_URL: z.string().default('smtp://mailpit:1025'),
    MAIL_FROM: z.string().default('EcoManage <alerts@ecomanage.local>'),
    APP_URL: z.string().default('http://localhost:5173'),
    EMAIL_EVERY_MS: z.coerce.number().int().positive().default(30_000),
    FORECAST_EVERY_MS: z.coerce.number().int().positive().default(3_600_000),
    WEATHER_PROVIDER: z.enum(['simulated', 'open-meteo']).default('simulated'),
    // The simulator's seed, so the simulated site is forecast from its own weather.
    WEATHER_SEED: z.coerce.number().int().default(42),
  })
  .parse(process.env);

const log = pino({ level: env.LOG_LEVEL });

const QUEUE = QUEUES.billing;

const main = async () => {
  await mongoose.connect(env.DATABASE_URL);
  await initModels();
  // BullMQ needs blocking commands, so no per-request retry limit on its connection.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE, { connection });
  await queue.upsertJobScheduler('cost-intervals', { every: env.COST_EVERY_MS }, { name: 'cost-intervals' });
  // Hourly; each site is recomputed in the hour its local clock reads 01:xx.
  await queue.upsertJobScheduler('nightly-bills', { pattern: '5 * * * *' }, { name: 'nightly-bills' });

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === 'cost-intervals') {
        let total = 0;
        // A few passes drain a backlog (5000 per pass) without spinning on intervals ingest keeps recomputing.
        for (let pass = 0; pass < 10; pass++) {
          const n = await costPendingIntervals();
          total += n;
          if (n === 0) break;
        }
        if (total) log.info({ intervals: total }, 'priced intervals');
        return total;
      }
      if (job.name === 'nightly-bills') {
        const sites = await nightlyBills();
        if (sites) log.info({ sites }, 'nightly bills');
        return sites;
      }
      throw new Error(`unknown job ${job.name}`);
    },
    { connection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));

  // Statements and utility bills are requested by the API, so they get their own queue and
  // don't wait behind a long billing pass.
  const documents = new Worker(
    QUEUES.documents,
    async (job) => {
      if (job.name === 'statement') return statementJob(job.data);
      if (job.name === 'utility-bill') {
        const result = await utilityBillJob(job.data);
        log.info({ period: job.data.period, ...result }, 'utility bill read');
        return result;
      }
      throw new Error(`unknown job ${job.name}`);
    },
    { connection, concurrency: 2 }
  );
  documents.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));

  // Alert emails and escalation every 30 s; the daily summary check rides along (it sends in the
  // hour after 07:00 site time, once per site and day).
  const mailer = createMailer(env.SMTP_URL, env.MAIL_FROM);
  const emailQueue = new Queue(QUEUES.email, { connection });
  await emailQueue.upsertJobScheduler('notify', { every: env.EMAIL_EVERY_MS }, { name: 'notify' });
  const email = new Worker(
    QUEUES.email,
    async () => {
      const sent = await notifyAlerts(mailer, env.APP_URL);
      const daily = await dailySummaries(mailer, env.APP_URL);
      const proposals = await notifyProposals(mailer, env.APP_URL);
      if (sent.alerts || sent.escalations || daily || proposals) log.info({ ...sent, daily, proposals }, 'emails sent');
      return { ...sent, daily, proposals };
    },
    { connection, concurrency: 1 }
  );
  email.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));

  // Forecasts: every site hourly (the first run at start-up), one site on demand when its
  // calendar or solar arrays change.
  const weather = env.WEATHER_PROVIDER === 'open-meteo' ? openMeteoWeather() : simulatedWeather(env.WEATHER_SEED);
  const forecastQueue = new Queue(QUEUES.forecast, { connection });
  await forecastQueue.upsertJobScheduler('forecast-all', { every: env.FORECAST_EVERY_MS, immediately: true }, { name: 'forecast-all' });
  const forecasts = new Worker(
    QUEUES.forecast,
    async (job) => {
      if (job.name === 'forecast-site') return forecastSite(job.data.siteId, weather);
      const { runs, scores } = await forecastAll(weather);
      for (const s of scores) log.info({ siteId: s.siteId, kind: s.kind, mape: s.mape, n: s.n, issuedAt: s.issuedAt }, 'forecast accuracy (MAPE %)');
      const skipped = runs.filter((r) => r.reason);
      log.info({ sites: runs.length, skipped: skipped.map((r) => ({ siteId: r.siteId, reason: r.reason })) }, 'forecasts issued');
      return runs.length;
    },
    { connection, concurrency: 1 }
  );
  forecasts.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));
  log.info('worker ready');

  const stop = async () => {
    await forecasts.close();
    await forecastQueue.close();
    await email.close();
    await emailQueue.close();
    await documents.close();
    await worker.close();
    await queue.close();
    connection.disconnect();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
};

main().catch((err) => {
  log.fatal({ err: err.message }, 'worker failed to start');
  process.exit(1);
});
