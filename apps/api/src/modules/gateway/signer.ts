import 'reflect-metadata'; // @peculiar/x509 needs it loaded first
import { randomBytes, webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as x509 from '@peculiar/x509';

// Signs a claimed gateway's certificate request with the broker's CA (P5-04). The subject is set
// here, never taken from the request: CN = the site id, which the broker uses as the username, so
// its ACL (site/%u/#) keeps the gateway to its own site.

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

export interface CertSigner {
  /** The CA certificate the gateway should trust (PEM). */
  caPem: string;
  sign(csrPem: string, cn: string): Promise<{ pem: string; serialNumber: string; notAfter: Date }>;
}

const DAY = 86_400_000;

const der = (pem: string) => {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

/**
 * The signer from the CA's files, or undefined when the key isn't there (claiming then waits
 * until it is). The key is only imported on first use.
 */
export const signerFromFiles = (caPath: string, keyPath: string): CertSigner | undefined => {
  if (!existsSync(caPath) || !existsSync(keyPath)) return undefined;
  const caPem = readFileSync(caPath, 'utf8');
  let ready: Promise<CertSigner> | null = null;
  return {
    caPem,
    sign: async (csrPem, cn) => (await (ready ??= createCertSigner(caPem, readFileSync(keyPath, 'utf8')))).sign(csrPem, cn),
  };
};

export const createCertSigner = async (caPem: string, caKeyPem: string, days = 825): Promise<CertSigner> => {
  if (!/BEGIN PRIVATE KEY/.test(caKeyPem)) throw new Error('The CA key must be PKCS#8 ("BEGIN PRIVATE KEY")');
  const ca = new x509.X509Certificate(caPem);
  // An RSA CA (what gen-certs.sh makes) or an EC one.
  const namedCurve = (ca.publicKey.algorithm as { namedCurve?: string }).namedCurve;
  const alg = namedCurve ? { name: 'ECDSA', hash: 'SHA-256', namedCurve } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const signingKey = await webcrypto.subtle.importKey('pkcs8', der(caKeyPem), namedCurve ? { name: 'ECDSA', namedCurve } : alg, false, ['sign']);
  const authorityKeyId = await x509.AuthorityKeyIdentifierExtension.create(ca);

  return {
    caPem: ca.toString('pem'),
    async sign(csrPem, cn) {
      if (!/^[A-Za-z0-9_.:-]+$/.test(cn)) throw new Error('Unexpected certificate name');
      const csr = new x509.Pkcs10CertificateRequest(csrPem);
      if (!(await csr.verify())) throw new Error('The certificate request is not signed by its own key');
      const serial = randomBytes(16);
      serial[0] &= 0x7f; // a positive serial number
      const serialNumber = serial.toString('hex');
      const now = Date.now();
      const notAfter = new Date(now + days * DAY);
      const cert = await x509.X509CertificateGenerator.create({
        serialNumber,
        subject: `CN=${cn}`,
        issuer: ca.subject,
        notBefore: new Date(now - 5 * 60_000), // a gateway clock a little behind still accepts it
        notAfter,
        signingAlgorithm: alg,
        publicKey: csr.publicKey,
        signingKey,
        extensions: [
          new x509.BasicConstraintsExtension(false, undefined, true),
          new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
          new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth]),
          authorityKeyId,
        ],
      });
      return { pem: cert.toString('pem'), serialNumber, notAfter };
    },
  };
};
