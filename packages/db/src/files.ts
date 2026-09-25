import mongoose, { Types } from 'mongoose';
import type { Readable } from 'node:stream';

// Uploaded and generated files (utility bills, statements; later reports and 3D models) in
// GridFS, bucket `files`. Metadata records the site, so a request can only reach its own files.

export interface FileMeta {
  siteId: string;
  kind: 'utility-bill' | 'statement' | 'report';
  contentType: string;
  [key: string]: unknown;
}

export interface StoredFile {
  id: string;
  filename: string;
  length: number;
  metadata: FileMeta;
}

const bucket = () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'files' });
};

export const putFile = (filename: string, data: Buffer, metadata: FileMeta): Promise<string> =>
  new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata });
    upload.once('error', reject);
    upload.once('finish', () => resolve(String(upload.id)));
    upload.end(data);
  });

export const fileInfo = async (id: string): Promise<StoredFile | null> => {
  if (!Types.ObjectId.isValid(id)) return null;
  const [f] = await bucket().find({ _id: new Types.ObjectId(id) }).toArray();
  return f ? { id, filename: f.filename, length: f.length, metadata: f.metadata as FileMeta } : null;
};

export const openFile = (id: string): Readable => bucket().openDownloadStream(new Types.ObjectId(id));

export const readFileBuffer = async (id: string): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of openFile(id)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

export const deleteFile = async (id: string): Promise<void> => {
  await bucket().delete(new Types.ObjectId(id));
};

/** Removes every file of a site (demo reset). */
export const deleteSiteFiles = async (siteId: string): Promise<number> => {
  const b = bucket();
  const files = await b.find({ 'metadata.siteId': siteId }).toArray();
  for (const f of files) await b.delete(f._id);
  return files.length;
};
