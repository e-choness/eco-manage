import mongoose from 'mongoose';
import type { Readable } from 'node:stream';
import { Export, fileInfo, openFile, recordAudit, type ExportDoc, type SiteDoc } from '@ecomanage/db';
import { daysBetween, type ExportCreate, type ExportView, type Role } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';

// History → Export CSV (P4-05). The worker writes every 15-minute interval of the range; ranges
// over a year are also emailed to the requester as a link when ready.

const LARGE_DAYS = 366;
const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

const toView = (e: ExportDoc): ExportView => ({
  id: String(e._id),
  from: e.from,
  to: e.to,
  status: e.status as ExportView['status'],
  rows: e.rows ?? null,
  error: e.error ?? null,
  large: e.large,
  createdAt: e.createdAt.toISOString(),
});

export const createExport = async (jobs: JobClient | undefined, site: SiteDoc, userId: string, role: Role, body: ExportCreate): Promise<ExportView> => {
  if (!jobs) throw fail(503, 'Exports are unavailable right now (no worker queue)');
  const doc = await Export.create({
    siteId: site._id,
    userId,
    from: body.from,
    to: body.to,
    includeCost: role !== 'installer',
    large: daysBetween(body.from, body.to) > LARGE_DAYS,
  });
  await jobs.add('export-csv', { exportId: String(doc._id) });
  await recordAudit({ siteId: site._id, userId, action: 'export.create', target: `export:${doc._id}`, after: { from: body.from, to: body.to } });
  return toView(doc.toObject() as ExportDoc);
};

const findExport = async (site: SiteDoc, id: string) => {
  const e = mongoose.isValidObjectId(id) ? await Export.findOne({ _id: id, siteId: site._id }).lean<ExportDoc>() : null;
  if (!e) throw fail(404, 'Export not found');
  return e;
};

export const getExport = async (site: SiteDoc, id: string): Promise<ExportView> => toView(await findExport(site, id));

export const exportFile = async (site: SiteDoc, id: string): Promise<{ filename: string; stream: Readable }> => {
  const e = await findExport(site, id);
  if (e.status !== 'done' || !e.fileId) throw fail(409, e.status === 'failed' ? `The export failed: ${e.error ?? 'unknown error'}` : 'The export is still being made');
  const info = await fileInfo(e.fileId);
  if (!info || info.metadata.siteId !== String(site._id)) throw fail(404, 'Export file not found');
  return { filename: info.filename, stream: openFile(e.fileId) };
};
