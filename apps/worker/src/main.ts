import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import { z } from 'zod';
import { initModels } from '@ecomanage/db';
import { costPendingIntervals, nightlyBills } from './billing';

const env = z
  .object({
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    LOG_LEVEL: z.string().default('info'),
    COST_EVERY_MS: z.coerce.number().int().positive().default(60_000),
  })
  .parse(process.env);

const log = pino({ level: env.LOG_LEVEL });

const QUEUE = 'billing';

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
  log.info('worker ready');

  const stop = async () => {
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
