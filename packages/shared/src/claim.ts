import { z } from 'zod';

// Claiming a gateway (P5-04, Data and Device Audit §4 step 01). Each gateway leaves the factory
// with a serial number and a one-time claim code, printed together as a QR code. On first boot it
// makes its own key, connects with the shared bootstrap certificate (the broker lets it use only
// claim/{its client id}/…) and publishes a certificate request with a proof that it knows the
// code. The installer claims it for a site in the app; the cloud then signs the request (the
// certificate's CN is the site id) and sends it back. From then on the gateway connects with that
// certificate only.

export const claimTopics = {
  /** Gateway → cloud: the certificate request, repeated until a certificate comes back. */
  csr: (serial: string) => `claim/${serial}/csr`,
  /** Cloud → gateway: the signed certificate. */
  cert: (serial: string) => `claim/${serial}/cert`,
} as const;

export const CLAIM_CSR_FILTER = 'claim/+/csr';

export const GATEWAY_SERIAL = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
// 20 characters of Crockford base32 (100 bits), shown in groups of four.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CLAIM_CODE_LENGTH = 20;

/** Upper case, without spaces or dashes, with the letters people mistake for digits mapped back. */
export const normalizeClaimCode = (code: string): string =>
  code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

export const isClaimCode = (code: string): boolean => code.length === CLAIM_CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

/** A code from random bytes (at least 13), for the factory. */
export const claimCodeFrom = (bytes: Uint8Array): string => {
  let bits = 0n;
  for (const b of bytes.slice(0, 13)) bits = (bits << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) out += CODE_ALPHABET[Number((bits >> BigInt(5 * i)) & 31n)];
  return out;
};

export const formatClaimCode = (code: string): string => code.match(/.{1,4}/g)!.join('-');

// The QR code on the gateway: "ecomanage-gw:1:<serial>:<code>".
const QR_PREFIX = 'ecomanage-gw:1:';
export const gatewayQr = (serial: string, code: string): string => `${QR_PREFIX}${serial}:${code}`;

/** The serial and code from the QR text, or null if it isn't one. */
export const parseGatewayQr = (text: string): { serial: string; code: string } | null => {
  const t = text.trim();
  if (!t.startsWith(QR_PREFIX)) return null;
  const [serial, code, ...rest] = t.slice(QR_PREFIX.length).split(':');
  if (rest.length || !serial || !code) return null;
  const c = normalizeClaimCode(code);
  return GATEWAY_SERIAL.test(serial) && isClaimCode(c) ? { serial, code: c } : null;
};

export const claimCsrMessage = z.object({
  csr: z.string().min(100).max(8000), // PEM
  proof: z.string().regex(/^[0-9a-f]{64}$/), // HMAC-SHA256 of the PEM, keyed by the claim key
  fw: z.string().max(40),
  ts: z.string().datetime({ offset: true }),
});
export type ClaimCsrMessage = z.infer<typeof claimCsrMessage>;

export const claimCertMessage = z.object({
  siteId: z.string(),
  cert: z.string(), // PEM, CN = siteId
  ca: z.string(), // PEM of the broker's CA
  ts: z.string().datetime({ offset: true }),
});
export type ClaimCertMessage = z.infer<typeof claimCertMessage>;

/** POST /api/site/gateway/claim (owner, installer): the QR text, or the serial and code typed in. */
export const gatewayClaimInput = z.union([
  z.object({ qr: z.string().max(200) }).strict(),
  z.object({ serial: z.string().trim().toUpperCase().regex(GATEWAY_SERIAL, 'That isn’t a gateway serial number'), code: z.string().max(40) }).strict(),
]);
export type GatewayClaimInput = z.infer<typeof gatewayClaimInput>;
