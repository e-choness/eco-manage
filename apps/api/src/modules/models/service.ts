import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { ModelUpload, assetUrl, recordAudit, type ModelUploadDoc, type ObjectStore, type SiteDoc } from '@ecomanage/db';
import { modelFileProblem, modelFormatOf, type ModelUploadView, type SiteModel as SiteModelView } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import type { JobClient } from '../../lib/jobs';
import User from '../auth/model';
import { saveSiteModelVersion, siteModel } from '../site/home';

// Settings → Site model → Upload a 3D file (P5-02). The API makes the first checks (size, type,
// signature), keeps the original in private object storage and queues it; the worker runs it
// through the sandboxed converter. A ready upload becomes the site model with "Use this model".

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

export interface UploadDeps {
  jobs?: JobClient;
  objects?: ObjectStore;
}

const view = (u: ModelUploadDoc, names: Map<string, string>, inUse: string | null): ModelUploadView => ({
  id: String(u._id),
  originalName: u.originalName,
  format: u.format as ModelUploadView['format'],
  bytes: u.bytes,
  status: u.status as ModelUploadView['status'],
  reason: u.reason ?? null,
  glbUrl: u.status === 'ready' && u.assetPrefix ? assetUrl(`${u.assetPrefix}model.glb`) : null,
  thumbUrl: u.status === 'ready' && u.assetPrefix && u.hasThumb ? assetUrl(`${u.assetPrefix}thumb.png`) : null,
  glbBytes: u.glbBytes ?? null,
  tris: u.tris ?? null,
  trisIn: u.trisIn ?? null,
  bbox: u.bbox ? { min: u.bbox.min as [number, number, number], max: u.bbox.max as [number, number, number] } : null,
  scale: u.scale ?? null,
  inUse: inUse === String(u._id),
  createdBy: { id: String(u.userId), name: names.get(String(u.userId)) ?? 'Former user' },
  createdAt: u.createdAt.toISOString(),
  processedAt: u.processedAt ? u.processedAt.toISOString() : null,
});

const views = async (site: SiteDoc, docs: ModelUploadDoc[]): Promise<ModelUploadView[]> => {
  const users = await User.find({ _id: { $in: [...new Set(docs.map((d) => String(d.userId)))] } }).select('name email').lean();
  const names = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  const current = await siteModel(site);
  return docs.map((d) => view(d, names, current.upload?.uploadId ?? null));
};

export const listUploads = async (site: SiteDoc): Promise<{ items: ModelUploadView[] }> => {
  const docs = await ModelUpload.find({ siteId: site._id }).sort({ createdAt: -1, _id: -1 }).limit(20).lean<ModelUploadDoc[]>();
  return { items: await views(site, docs) };
};

const findUpload = async (site: SiteDoc, id: string) => {
  const u = mongoose.isValidObjectId(id) ? await ModelUpload.findOne({ _id: id, siteId: site._id }).lean<ModelUploadDoc>() : null;
  if (!u) throw fail(404, 'Upload not found');
  return u;
};

export const getUpload = async (site: SiteDoc, id: string): Promise<ModelUploadView> => (await views(site, [await findUpload(site, id)]))[0];

/** Checks the file, stores the original and queues it. A file we can't use is refused with the reason (422). */
export const createUpload = async ({ jobs, objects }: UploadDeps, site: SiteDoc, userId: string, file: { originalname: string; buffer: Buffer } | undefined): Promise<ModelUploadView> => {
  if (!file) throw fail(400, 'Choose a 3D file to upload (form field `file`).');
  const name = file.originalname.replace(/[\\/]/g, '_').slice(0, 200);
  const problem = modelFileProblem(name, file.buffer);
  if (problem) throw fail(422, problem);
  if (!objects || !jobs) throw fail(503, 'Model uploads are unavailable right now (no storage or worker queue)');
  const format = modelFormatOf(name)!;
  const id = new mongoose.Types.ObjectId();
  const originalKey = `uploads/${site._id}/${id}-${randomBytes(6).toString('hex')}/original.${format}`;
  await objects.put(originalKey, file.buffer, 'application/octet-stream');
  const doc = await ModelUpload.create({ _id: id, siteId: site._id, userId, originalName: name, format, bytes: file.buffer.length, originalKey });
  await recordAudit({ siteId: site._id, userId, action: 'siteModel.upload', target: `modelUpload:${id}`, after: { originalName: name, format, bytes: file.buffer.length } });
  await jobs.processModelUpload(String(id));
  return (await views(site, [doc.toObject() as ModelUploadDoc]))[0];
};

/** "Use this model": the next site model version draws the processed GLB; anchors carry over. */
export const useUpload = async (site: SiteDoc, userId: string, id: string): Promise<SiteModelView> => {
  const u = await findUpload(site, id);
  if (u.status !== 'ready' || !u.assetPrefix) throw fail(409, u.status === 'rejected' ? `This file can’t be used: ${u.reason}` : 'This upload hasn’t finished processing');
  const current = await siteModel(site);
  const upload = { uploadId: String(u._id), assetPrefix: u.assetPrefix, hasThumb: u.hasThumb, originalName: u.originalName, tris: u.tris, bytes: u.glbBytes, bbox: u.bbox, scale: u.scale };
  return saveSiteModelVersion(site, userId, { hub: current.hub, anchors: current.anchors, buildingLabel: current.buildingLabel, camera: current.camera }, { source: 'upload', upload });
};

/** Removes an upload that isn't the current model, with its files. */
export const deleteUpload = async ({ objects }: UploadDeps, site: SiteDoc, userId: string, id: string): Promise<void> => {
  const u = await findUpload(site, id);
  if ((await siteModel(site)).upload?.uploadId === String(u._id)) throw fail(409, 'This model is in use. Switch the site to another model first.');
  if (u.status === 'queued' || u.status === 'processing') throw fail(409, 'This upload is still being processed');
  await ModelUpload.deleteOne({ _id: u._id });
  // Older site model versions may still point at it; they are history and are never drawn again.
  await Promise.all([u.assetPrefix ? objects?.removePrefix(u.assetPrefix) : null, u.originalKey ? objects?.remove(u.originalKey) : null]);
  await recordAudit({ siteId: site._id, userId, action: 'siteModel.uploadDelete', target: `modelUpload:${u._id}`, before: { originalName: u.originalName } });
};

