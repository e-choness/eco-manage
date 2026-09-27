import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Object storage for 3D models (P5-02): any S3-compatible store (RustFS in development). Uploaded
// originals live under `uploads/` (private); processed models under `models/<random>/`, which the
// CDN serves. Links are built from ASSET_PUBLIC_URL, so the CDN in front can change without
// touching stored records.

export interface ObjectStoreConfig {
  endpoint?: string; // unset: AWS itself
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string; // where the CDN serves the bucket, e.g. https://cdn.example.com or /cdn
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Removes every object under a prefix. */
  removePrefix(prefix: string): Promise<number>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export const objectStoreConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ObjectStoreConfig | null =>
  env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
    ? {
        endpoint: env.S3_ENDPOINT || undefined,
        region: env.S3_REGION || 'us-east-1',
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
        publicUrl: env.ASSET_PUBLIC_URL || '/cdn',
      }
    : null;

export const createObjectStore = (config: ObjectStoreConfig): ObjectStore => {
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: !!config.endpoint, // RustFS, MinIO and most S3-compatible stores
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;
  const base = config.publicUrl.replace(/\/$/, '');
  return {
    async put(key, body, contentType, cacheControl) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
    },
    async get(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async removePrefix(prefix) {
      let removed = 0;
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
        removed += keys.length;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return removed;
    },
    async remove(key) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: key }] } }));
    },
    publicUrl: (key) => assetUrl(key, base),
  };
};

/** A CDN link for a stored object (processed models): ASSET_PUBLIC_URL, `/cdn` by default. */
export const assetUrl = (key: string, base = process.env.ASSET_PUBLIC_URL || '/cdn'): string => `${base.replace(/\/$/, '')}/${key}`;
