import { logger } from '../config/logger';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, REPORT_JOB_OPTS, reportCron, reportOnceJobId, reportSchedulerId, type DocumentJobs, type InviteJob, type ModelUploadJob, type RepeatingSchedule, type ReportJob } from '@ecomanage/shared';

// Producer side of the worker's queues (documents, forecast, email, reports, models). Controllers get it
// through createApp, so tests can pass a stand-in that runs the job in process (or never answers).

export type DocumentJobName = keyof DocumentJobs;

export interface JobClient {
  /** Queue a job and return straight away. */
  add<N extends DocumentJobName>(name: N, data: DocumentJobs[N]['data']): Promise<void>;
  /** Queue a job and wait for its result; rejects on failure or after `timeoutMs`. */
  run<N extends DocumentJobName>(name: N, data: DocumentJobs[N]['data'], timeoutMs: number): Promise<DocumentJobs[N]['result']>;
  /** Asks the worker to redo one site's forecasts now (after calendar or solar array changes). */
  requestForecast(siteId: string): Promise<void>;
  /** Asks the worker to email an invite link (P4-02). */
  sendInvite(job: InviteJob): Promise<void>;
  /** Renders a one-off report now (P5-01). */
  renderReport(reportId: string): Promise<void>;
  /** Weekly or monthly report: a job scheduler at 07:00 site time (Monday or the 1st). */
  scheduleReport(reportId: string, schedule: RepeatingSchedule, tz: string): Promise<void>;
  /** Runs an uploaded 3D model through the converter (P5-02). */
  processModelUpload(uploadId: string): Promise<void>;
  /** Stops a report's schedule. */
  unscheduleReport(reportId: string): Promise<void>;
  close(): Promise<void>;
}

export class JobTimeout extends Error {}

export const createJobClient = (redisUrl: string): JobClient => {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.documents, { connection });
  const forecastQueue = new Queue(QUEUES.forecast, { connection });
  const emailQueue = new Queue(QUEUES.email, { connection });
  const reportQueue = new Queue(QUEUES.reports, { connection });
  const modelQueue = new Queue(QUEUES.models, { connection });
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
    async sendInvite(job) {
      // No copy of the token is kept once the email has gone.
      await emailQueue.add('invite', job, { attempts: 3, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true, removeOnFail: true });
    },
    async renderReport(reportId) {
      await reportQueue.add('report', { reportId } satisfies ReportJob, { ...REPORT_JOB_OPTS, jobId: reportOnceJobId(reportId) });
    },
    async scheduleReport(reportId, schedule, tz) {
      await reportQueue.upsertJobScheduler(reportSchedulerId(reportId), { pattern: reportCron(schedule), tz }, { name: 'report', data: { reportId, scheduled: true } satisfies ReportJob, opts: REPORT_JOB_OPTS });
    },
    async processModelUpload(uploadId) {
      await modelQueue.add('model-upload', { uploadId } satisfies ModelUploadJob, { attempts: 2, backoff: { type: 'fixed', delay: 15_000 }, removeOnComplete: 100, removeOnFail: 200, jobId: `model-upload-${uploadId}` });
    },
    async unscheduleReport(reportId) {
      await reportQueue.removeJobScheduler(reportSchedulerId(reportId));
    },
    async close() {
      await events.close();
      await queue.close();
      await forecastQueue.close();
      await emailQueue.close();
      await reportQueue.close();
      await modelQueue.close();
      connection.disconnect();
    },
  };
};

/** Asks for a forecast rerun without failing the request that caused it (the hourly run catches up). */
export const rerunForecast = (jobs: JobClient | undefined, siteId: string): void => {
  jobs?.requestForecast(siteId).catch((err: Error) => logger.warn({ siteId, err: err.message }, 'forecast rerun not queued'));
};
