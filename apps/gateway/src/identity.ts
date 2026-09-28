import 'reflect-metadata'; // @peculiar/x509 needs it loaded first
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';

// The gateway's identity (P5-04). Its private key is made here and never leaves it; the cloud
// only ever sees the certificate request. Once claimed, the certificate (CN = site id) is kept
// with the key and used for every connection.

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const EC = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

export interface PendingKey {
  keyPem: string; // PKCS#8
  csrPem: string;
}

export interface Identity {
  siteId: string;
  certPem: string;
  keyPem: string;
  caPem: string;
}

export const makeRequest = async (serial: string): Promise<PendingKey> => {
  const keys = await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify']);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({ name: `CN=${serial}`, keys, signingAlgorithm: EC });
  const keyPem = x509.PemConverter.encode(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey), 'PRIVATE KEY');
  return { keyPem, csrPem: csr.toString('pem') };
};

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) => Buffer.from(a).equals(Buffer.from(b));

/** Whether the certificate is for our key, names the site, and is signed by the CA it came with. */
export const certFits = async (certPem: string, csrPem: string, caPem: string, siteId: string): Promise<boolean> => {
  try {
    const cert = new x509.X509Certificate(certPem);
    const csr = new x509.Pkcs10CertificateRequest(csrPem);
    const ca = new x509.X509Certificate(caPem);
    return cert.subject === `CN=${siteId}` && sameBytes(cert.publicKey.rawData, csr.publicKey.rawData) && (await cert.verify({ publicKey: ca.publicKey, signatureOnly: true }));
  } catch {
    return false;
  }
};
