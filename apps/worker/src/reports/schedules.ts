import type { Queue } from 'bullmq';
import { Report, Site, type ReportDoc } from '@ecomanage/db';
import { REPORT_JOB_OPTS, reportCron, reportOnceJobId, reportSchedulerId, type ReportJob } from '@ecomanage/shared';

// Weekly and monthly reports as BullMQ job schedulers in the site's time zone (P5-01): one per
// report, 07:00 on Monday or the 1st. The API adds and removes them as reports are made and
// removed; this sweep puts them right again (a lost Redis, a site's time zone changed) and picks
// up one-off reports that never got their job.

export interface SweepResult {
  scheduled: number;
  removed: number;
  queued: number;
}

export const syncReportSchedules = async (queue: Queue, now = new Date()): Promise<SweepResult> => {
  const reports = await Report.find({}).select('siteId schedule status lastRunAt createdAt').lean<ReportDoc[]>();
  const tz = new Map((await Site.find({ _id: { $in: [...new Set(reports.map((r) => String(r.siteId)))] } }).select('tz').lean()).map((s) => [String(s._id), s.tz]));

  const wanted = new Set<string>();
  let queued = 0;
  for (const r of reports) {
    const id = String(r._id);
    const zone = tz.get(String(r.siteId));
    if (!zone) continue;
    if (r.schedule === 'weekly' || r.schedule === 'monthly') {
      wanted.add(reportSchedulerId(id));
      await queue.upsertJobScheduler(reportSchedulerId(id), { pattern: reportCron(r.schedule), tz: zone }, { name: 'report', data: { reportId: id, scheduled: true } satisfies ReportJob, opts: REPORT_JOB_OPTS });
    } else if (r.status === 'waiting' && !r.lastRunAt && now.getTime() - r.createdAt.getTime() > 60_000) {
      // The same job id as the API's, so a job still in the queue isn't doubled.
      await queue.add('report', { reportId: id } satisfies ReportJob, { ...REPORT_JOB_OPTS, jobId: reportOnceJobId(id) });
      queued++;
    }
  }

  let removed = 0;
  for (const s of await queue.getJobSchedulers(0, -1)) {
    const key = s.key ?? (s as { id?: string }).id;
    if (key?.startsWith('report:') && !wanted.has(key)) {
      await queue.removeJobScheduler(key);
      removed++;
    }
  }
  return { scheduled: wanted.size, removed, queued };
};
