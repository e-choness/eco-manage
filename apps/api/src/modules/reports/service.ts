import mongoose from 'mongoose';
import { Report, recordAudit, type ReportDoc, type SiteDoc } from '@ecomanage/db';
import type { ReportCreate, ReportView, Role } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';

// History → Reports (P4-05): report definitions. The reports worker (P5-01) renders them and runs
// their schedules; until it has, a report is `waiting` and has no file.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

const views = async (docs: ReportDoc[], userId: string, role: Role): Promise<ReportView[]> => {
  const ids = [...new Set(docs.map((d) => String(d.createdBy)))];
  const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  return docs.map((d) => ({
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
    createdBy: { id: String(d.createdBy), name: names.get(String(d.createdBy)) ?? 'Former user' },
    createdAt: d.createdAt.toISOString(),
    canDelete: role === 'owner' || String(d.createdBy) === userId,
  }));
};

export const listReports = async (site: SiteDoc, userId: string, role: Role): Promise<{ items: ReportView[] }> => {
  const docs = await Report.find({ siteId: site._id }).sort({ createdAt: -1, _id: -1 }).limit(100).lean<ReportDoc[]>();
  return { items: await views(docs, userId, role) };
};

export const createReport = async (site: SiteDoc, userId: string, role: Role, body: ReportCreate): Promise<ReportView> => {
  if (role === 'installer' && body.sections.includes('cost')) throw fail(403, 'Installers can’t include energy cost in a report');
  const doc = await Report.create({ siteId: site._id, createdBy: userId, ...body });
  await recordAudit({ siteId: site._id, userId, action: 'report.create', target: `report:${doc._id}`, after: body });
  return (await views([doc.toObject() as ReportDoc], userId, role))[0];
};

const findReport = async (site: SiteDoc, id: string) => {
  const r = mongoose.isValidObjectId(id) ? await Report.findOne({ _id: id, siteId: site._id }).lean<ReportDoc>() : null;
  if (!r) throw fail(404, 'Report not found');
  return r;
};

/** Stops a schedule and removes the report: its creator or the owner. */
export const deleteReport = async (site: SiteDoc, userId: string, role: Role, id: string): Promise<void> => {
  const r = await findReport(site, id);
  if (role !== 'owner' && String(r.createdBy) !== userId) throw fail(403, 'Only the person who made this report or the owner can remove it');
  await Report.deleteOne({ _id: r._id });
  await recordAudit({ siteId: site._id, userId, action: 'report.delete', target: `report:${r._id}`, before: { name: r.name, schedule: r.schedule } });
};

/** The rendered file; until the reports worker has made one there is none. */
export const reportFile = async (site: SiteDoc, id: string) => {
  const r = await findReport(site, id);
  if (r.status !== 'ready' || !r.fileId) throw fail(409, r.status === 'failed' ? 'This report failed to render' : 'This report hasn’t been generated yet');
  return r;
};
