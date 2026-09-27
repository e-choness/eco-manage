import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Report, deleteFile, recordAudit, type ReportDoc, type SiteDoc } from '@ecomanage/db';
import { nextReportRun, type ReportCreate, type ReportView, type Role } from '@ecomanage/shared';
import { logger } from '../../config/logger';
import { HttpError } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import User from '../auth/model';

// History → Reports (P4-05, P5-01). The reports worker renders a one-off report straight away and
// a weekly or monthly one at 07:00 site time on Monday or the 1st, from a job scheduler this
// module adds and removes (the worker's sweep puts them right if a call here is lost).

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

const views = async (docs: ReportDoc[], site: SiteDoc, userId: string, role: Role, now: Date): Promise<ReportView[]> => {
  const ids = [...new Set(docs.map((d) => String(d.createdBy)))];
  const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  return docs.map((d) => {
    const last = d.files?.at(-1);
    return {
      id: String(d._id),
      name: d.name,
      from: d.from,
      to: d.to,
      sections: d.sections as ReportView['sections'],
      format: d.format as ReportView['format'],
      schedule: d.schedule as ReportView['schedule'],
      recipients: d.recipients,
      notes: d.notes,
      status: d.status as ReportView['status'],
      error: d.error ?? null,
      lastRunAt: d.lastRunAt ? d.lastRunAt.toISOString() : null,
      lastRange: last ? { from: last.from, to: last.to } : null,
      nextRunAt: d.schedule === 'once' ? null : nextReportRun(d.schedule as 'weekly' | 'monthly', site.tz, now).toISOString(),
      createdBy: { id: String(d.createdBy), name: names.get(String(d.createdBy)) ?? 'Former user' },
      createdAt: d.createdAt.toISOString(),
      canDelete: role === 'owner' || String(d.createdBy) === userId,
    };
  });
};

export const listReports = async (site: SiteDoc, userId: string, role: Role, now = new Date()): Promise<{ items: ReportView[] }> => {
  const docs = await Report.find({ siteId: site._id }).sort({ createdAt: -1, _id: -1 }).limit(100).lean<ReportDoc[]>();
  return { items: await views(docs, site, userId, role, now) };
};

export const createReport = async (jobs: JobClient | undefined, site: SiteDoc, userId: string, role: Role, body: ReportCreate, now = new Date()): Promise<ReportView> => {
  if (role === 'installer' && body.sections.includes('cost')) throw fail(403, 'Installers can’t include energy cost in a report');
  const doc = await Report.create({ siteId: site._id, createdBy: userId, ...body });
  await recordAudit({ siteId: site._id, userId, action: 'report.create', target: `report:${doc._id}`, after: body });
  const id = String(doc._id);
  // Not fatal: without the queue the worker's sweep picks the report up within a few minutes.
  const queued = body.schedule === 'once' ? jobs?.renderReport(id) : jobs?.scheduleReport(id, body.schedule, site.tz);
  await queued?.catch((err: Error) => logger.warn({ reportId: id, err: err.message }, 'report job not queued'));
  return (await views([doc.toObject() as ReportDoc], site, userId, role, now))[0];
};

const findReport = async (site: SiteDoc, id: string) => {
  const r = mongoose.isValidObjectId(id) ? await Report.findOne({ _id: id, siteId: site._id }).lean<ReportDoc>() : null;
  if (!r) throw fail(404, 'Report not found');
  return r;
};

/** Stops a schedule and removes the report and its files (emailed links stop working): its creator or the owner. */
export const deleteReport = async (jobs: JobClient | undefined, site: SiteDoc, userId: string, role: Role, id: string): Promise<void> => {
  const r = await findReport(site, id);
  if (role !== 'owner' && String(r.createdBy) !== userId) throw fail(403, 'Only the person who made this report or the owner can remove it');
  await Report.deleteOne({ _id: r._id });
  if (r.schedule !== 'once') await jobs?.unscheduleReport(String(r._id)).catch((err: Error) => logger.warn({ reportId: id, err: err.message }, 'report schedule not removed'));
  const fileIds = new Set([r.fileId, ...(r.files ?? []).map((f) => f.fileId)].filter((f): f is string => !!f));
  for (const f of fileIds) await deleteFile(f).catch(() => undefined); // already gone
  await recordAudit({ siteId: site._id, userId, action: 'report.delete', target: `report:${r._id}`, before: { name: r.name, schedule: r.schedule } });
};

/** The latest rendered file; until the reports worker has made one there is none. */
export const reportFile = async (site: SiteDoc, id: string) => {
  const r = await findReport(site, id);
  if (r.status !== 'ready' || !r.fileId) throw fail(409, r.status === 'failed' ? `This report failed to render: ${r.error ?? 'unknown error'}` : 'This report hasn’t been generated yet');
  return r;
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** An emailed link (no sign-in): the file of that run while the link lasts. */
export const reportLinkFile = async (token: string, now = new Date()): Promise<{ fileId: string; format: string; siteId: string }> => {
  const hash = TOKEN.test(token) ? createHash('sha256').update(token).digest('hex') : null;
  const r = hash ? await Report.findOne({ 'files.tokenHash': hash }).select('siteId format files').lean<ReportDoc>() : null;
  const f = r?.files?.find((x) => x.tokenHash === hash);
  if (!r || !f?.fileId) throw fail(404, 'This link doesn’t exist, or its report was removed');
  if (!f.linkExpiresAt || f.linkExpiresAt <= now) throw fail(410, 'This link has expired. Ask the site for a new copy of the report.');
  return { fileId: f.fileId, format: r.format, siteId: String(r.siteId) };
};
