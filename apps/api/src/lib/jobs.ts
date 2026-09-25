import { logger } from '../config/logger';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, type DocumentJobs } from '@ecomanage/shared';

// Producer side of the worker's `documents` queue. Controllers get it through createApp, so tests
// can pass a stand-in that runs the job in process (or never answers).

export type DocumentJobName = keyof DocumentJobs;

export interface JobClient {
  /** Queue a job and return straight away. */
  add<N extends DocumentJobName>(name: N, data: DocumentJobs[N]['data']): Promise<void>;
  /** Queue a job and wait for its result; rejects on failure or after `timeoutMs`. */
  run<N extends DocumentJobName>(name: N, data: DocumentJobs[N]['data'], timeoutMs: number): Promise<DocumentJobs[N]['result']>;
  /** Asks the worker to redo one site's forecasts now (after calendar or solar array changes). */
  requestForecast(siteId: string): Promise<void>;
  close(): Promise<void>;
}

export class JobTimeout extends Error {}

export const createJobClient = (redisUrl: string): JobClient => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.documents, { connection });
  const forecastQueue = new Queue(QUEUES.forecast, { connection });
  // QueueEvents blocks on its connection, so it gets its own.
  const events = new QueueEvents(QUEUES.documents, { connection: connection.duplicate() });
  const opts = { attempts: 2, backoff: { type: 'fixed', delay: 2000 }, removeOnComplete: 100, removeOnFail: 500 };

  return {
    async add(name, data) {
      await queue.add(name, data, opts);
    },
    async run(name, data, timeoutMs) {
      const job = await queue.add(name, data, { ...opts, attempts: 1 });
      try {
        return await job.waitUntilFinished(events, timeoutMs);
      } catch (err) {
        if (/timed out/i.test((err as Error).message)) throw new JobTimeout(`${name} took longer than ${timeoutMs} ms`);
        throw err;
      }
    },
    async requestForecast(siteId) {
      // Saves within the same minute share one rerun (same job id).
      await forecastQueue.add('forecast-site', { siteId }, { ...opts, jobId: `forecast-${siteId}-${Math.floor(Date.now() / 60_000)}` });
    },
    async close() {
      await events.close();
      await queue.close();
      await forecastQueue.close();
      connection.disconnect();
    },
  };
};

/** Asks for a forecast rerun without failing the request that caused it (the hourly run catches up). */
export const rerunForecast = (jobs: JobClient | undefined, siteId: string): void => {
  jobs?.requestForecast(siteId).catch((err: Error) => logger.warn({ siteId, err: err.message }, 'forecast rerun not queued'));
};
