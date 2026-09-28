import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeClaimCode } from './claim';

// The claim proof (P5-04), for Node only: `@ecomanage/shared/claim-proof`. The cloud keeps the
// claim key (a hash of the code), never the code; the gateway derives the same key from its code.

export const claimKey = (code: string): string => createHash('sha256').update(`ecomanage-claim:${normalizeClaimCode(code)}`).digest('hex');

export const claimProof = (key: string, csrPem: string): string => createHmac('sha256', Buffer.from(key, 'hex')).update(csrPem).digest('hex');

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Whether the code typed in is the gateway's. */
export const codeMatches = (key: string, code: string): boolean => same(claimKey(code), key);

/** Whether the request comes from something that knows the gateway's code. */
export const proofMatches = (key: string, csrPem: string, proof: string): boolean => same(claimProof(key, csrPem), proof);
