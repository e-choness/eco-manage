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
  close(): Promise<void>;
}

export class JobTimeout extends Error {}

export const createJobClient = (redisUrl: string): JobClient => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.documents, { connection });
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
    async close() {
      await events.close();
      await queue.close();
      connection.disconnect();
    },
  };
};
