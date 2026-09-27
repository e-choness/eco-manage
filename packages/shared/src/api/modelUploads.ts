import type { ModelFormat } from '../modelFiles';

// Settings → Site model → Upload a 3D file (P5-02): POST /api/site/model/uploads and its status.

export const MODEL_UPLOAD_STATUSES = ['queued', 'processing', 'ready', 'rejected', 'failed'] as const;
export type ModelUploadStatus = (typeof MODEL_UPLOAD_STATUSES)[number];

export interface ModelBBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ModelUploadView {
  id: string;
  originalName: string;
  format: ModelFormat;
  bytes: number; // the uploaded file
  status: ModelUploadStatus; // rejected: the file can't be used (see reason); failed: our fault, try again
  reason: string | null;
  // Once ready: the GLB and its thumbnail on the CDN, and what processing did.
  glbUrl: string | null;
  thumbUrl: string | null;
  glbBytes: number | null;
  tris: number | null; // after simplifying (≤ 200k)
  trisIn: number | null; // as uploaded
  bbox: ModelBBox | null; // metres, after centring
  scale: number | null; // 1, or 0.01 / 0.001 when the file was in cm or mm
  inUse: boolean; // the current site model uses it
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  processedAt: string | null;
}
