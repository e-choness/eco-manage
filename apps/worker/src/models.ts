import { randomBytes } from 'node:crypto';
import { ModelUpload, type ModelUploadDoc, type ObjectStore } from '@ecomanage/db';
import type { ModelUploadJob } from '@ecomanage/shared';

// 3D model uploads (P5-02): the original from object storage goes to the sandboxed converter; the
// GLB and thumbnail come back and are stored under a new random prefix the CDN serves (so a new
// upload never reuses a cached path). The original is removed once it has been processed.

export type ConvertResponse =
  | { ok: true; glb: Buffer; thumbnail: Buffer; stats: { trisIn: number; tris: number; bbox: { min: number[]; max: number[] }; scale: number } }
  | { ok: false; reason: string };

export type Converter = (file: Buffer, format: string) => Promise<ConvertResponse>;

/** The converter service over HTTP; a 422 is a file we can't use, anything else is our failure. */
export const httpConverter =
  (baseUrl: string, timeoutMs = 300_000): Converter =>
  async (file, format) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-format': format },
      body: file,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { glb?: string; thumbnail?: string; stats?: never; reason?: string; error?: string };
    if (res.status === 422 || res.status === 413) return { ok: false, reason: body.reason ?? 'The file can’t be used.' };
    if (!res.ok || !body.glb) throw new Error(`converter answered ${res.status}: ${body.error ?? 'no model'}`);
    return { ok: true, glb: Buffer.from(body.glb, 'base64'), thumbnail: Buffer.from(body.thumbnail ?? '', 'base64'), stats: body.stats! };
  };

const IMMUTABLE = 'public, max-age=31536000, immutable';

export const processModelUpload = async (
  { uploadId }: ModelUploadJob,
  deps: { objects: ObjectStore; convert: Converter; now?: () => Date }
): Promise<{ status: string; tris?: number }> => {
  const now = deps.now ?? (() => new Date());
  const u = await ModelUpload.findById(uploadId).lean<ModelUploadDoc>();
  if (!u || !u.originalKey || (u.status !== 'queued' && u.status !== 'processing' && u.status !== 'failed')) return { status: 'skipped' };
  await ModelUpload.updateOne({ _id: u._id }, { $set: { status: 'processing', reason: null } });
  try {
    const result = await deps.convert(await deps.objects.get(u.originalKey), u.format);
    if (!result.ok) {
      await ModelUpload.updateOne({ _id: u._id }, { $set: { status: 'rejected', reason: result.reason, processedAt: now(), originalKey: null } });
      await deps.objects.remove(u.originalKey);
      return { status: 'rejected' };
    }
    const prefix = `models/${randomBytes(16).toString('hex')}/`;
    await deps.objects.put(`${prefix}model.glb`, result.glb, 'model/gltf-binary', IMMUTABLE);
    if (result.thumbnail.length) await deps.objects.put(`${prefix}thumb.png`, result.thumbnail, 'image/png', IMMUTABLE);
    const { stats } = result;
    await ModelUpload.updateOne(
      { _id: u._id },
      {
        $set: {
          status: 'ready',
          assetPrefix: prefix,
          hasThumb: result.thumbnail.length > 0,
          glbBytes: result.glb.length,
          tris: stats.tris,
          trisIn: stats.trisIn,
          bbox: stats.bbox,
          scale: stats.scale,
          processedAt: now(),
          originalKey: null,
        },
      }
    );
    await deps.objects.remove(u.originalKey);
    return { status: 'ready', tris: stats.tris };
  } catch (err) {
    // Our side (converter down, storage): the job retries; the uploader can also upload again.
    await ModelUpload.updateOne({ _id: u._id }, { $set: { status: 'failed', reason: 'Processing failed on our side. Try uploading the file again.' } });
    throw err;
  }
};
