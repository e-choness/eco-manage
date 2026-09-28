import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Secrets people give the API to keep (P5-05: a site's own language-model key), sealed with
// AES-256-GCM under a key derived from SECRETS_KEY. Without SECRETS_KEY nothing can be stored.

export interface Secrets {
  seal(plain: string): string;
  open(sealed: string): string;
}

const VERSION = 'v1';

export const createSecrets = (secret: string): Secrets => {
  const key = createHash('sha256').update(`ecomanage-secrets:${secret}`).digest();
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
    },
    open(sealed) {
      const [v, iv, tag, data] = sealed.split('.');
      if (v !== VERSION || !iv || !tag || !data) throw new Error('Unreadable secret');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
  };
};
