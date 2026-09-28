/**
 * P5-04: claiming a gateway with its QR code. The gateway's certificate request (with its proof of
 * the claim code) arrives over MQTT, stubbed here; the certificate is signed by a real test CA.
 */
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import * as x509 from '@peculiar/x509';
import { AuditEvent, Gateway, Membership, Site } from '@ecomanage/db';
import { gatewayQr, type ClaimCertMessage } from '@ecomanage/shared';
import { claimKey, claimProof } from '@ecomanage/shared/claim-proof';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import type { GatewayLink } from '../../lib/gatewayLink';
import { receiveCsr } from '../../modules/gateway/claim';
import { createCertSigner, type CertSigner } from '../../modules/gateway/signer';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const siteId = new mongoose.Types.ObjectId();
const otherSiteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };
const SERIAL = 'EM-GW-000123';
const CODE = 'K7Q2M9XH4TWR8ZB5N3CD';
const EC = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

// The broker side: certificates "sent" to gateways, or refused while it is down.
const sent: { serial: string; message: ClaimCertMessage }[] = [];
let brokerUp = true;
const gateway = {
  sendClaimCert: async (serial: string, message: ClaimCertMessage) => (brokerUp ? (sent.push({ serial, message }), true) : false),
} as unknown as GatewayLink;

let ca: x509.X509Certificate;
let signer: CertSigner;
let app: ReturnType<typeof createApp>;

/** What a gateway does on first boot: its own key and a request, with the proof of its code. */
const gatewayRequest = async (code = CODE, cn = SERIAL) => {
  const keys = await webcrypto.subtle.generateKey(EC, true, ['sign', 'verify']);
  const csr = (await x509.Pkcs10CertificateRequestGenerator.create({ name: `CN=${cn}`, keys, signingAlgorithm: EC })).toString('pem');
  return { csr, proof: claimProof(claimKey(code), csr), fw: '0.1.0', ts: new Date().toISOString() };
};

beforeAll(async () => {
  await connectTestDb('gateway_claim');
  process.env.JWT_SECRET = 'claim-jwt';
  const rsa = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const caKeys = await webcrypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
  ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Test CA',
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 86_400_000 * 900),
    keys: caKeys,
    signingAlgorithm: rsa,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  const caKeyPem = x509.PemConverter.encode(await webcrypto.subtle.exportKey('pkcs8', caKeys.privateKey), 'PRIVATE KEY');
  signer = await createCertSigner(ca.toString('pem'), caKeyPem);
  app = createApp({ env, gateway, signer });
  await Site.create([
    { _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' },
    { _id: otherSiteId, name: 'Riverside Library', tz: 'America/Toronto' },
  ]);
  const password = await generatePasswordHash('pw123456');
  for (const [role, site] of [['installer', siteId], ['owner', siteId], ['manager', siteId], ['other', otherSiteId]] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId: site, role: role === 'other' ? 'installer' : role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'claim-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  sent.length = 0;
  brokerUp = true;
  await Promise.all([Gateway.deleteMany({}), AuditEvent.deleteMany({}), Site.updateMany({}, { $set: { gatewayId: null } })]);
  await Gateway.create({ serial: SERIAL, claimKey: claimKey(CODE) });
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
const claim = (who: string, body: object) => as(who, request(app).post('/api/site/gateway/claim')).send(body);

const verify = async (pem: string) => {
  const cert = new x509.X509Certificate(pem);
  return { cn: cert.subject, issuer: cert.issuer, signedByCa: await cert.verify({ publicKey: ca.publicKey, signatureOnly: true }) };
};

describe('POST /api/site/gateway/claim', () => {
  it('certifies a gateway that has already asked, with the site id as its name', async () => {
    // It asked before anyone claimed it: kept, not answered.
    const req = await gatewayRequest(CODE, 'EM-GW-000123-or-any-site-it-likes');
    expect(await receiveCsr({ gateway, signer }, SERIAL, req)).toBe('waiting');
    expect(sent).toEqual([]);

    const res = await claim('installer', { qr: gatewayQr(SERIAL, CODE) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: SERIAL, claim: { serial: SERIAL, state: 'certified' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ serial: SERIAL, message: { siteId: String(siteId), ca: signer.caPem } });
    // The name comes from the site, never from the request.
    expect(await verify(sent[0].message.cert)).toEqual({ cn: `CN=${siteId}`, issuer: 'CN=Test CA', signedByCa: true });

    expect((await Site.findById(siteId).lean())?.gatewayId).toBe(SERIAL);
    expect(await AuditEvent.findOne({ action: 'gateway.claim' }).lean()).toMatchObject({ target: `gateway:${SERIAL}`, after: { gatewayId: SERIAL } });
    expect(await AuditEvent.countDocuments({ action: 'gateway.certificate', userId: null })).toBe(1);
  });

  it('waits for a gateway that hasn’t asked yet, then answers it when it does', async () => {
    const res = await claim('owner', { serial: 'em-gw-000123', code: 'k7q2-m9xh-4twr-8zb5-n3cd' });
    expect(res.body.claim).toMatchObject({ state: 'waiting' });
    expect(sent).toEqual([]);
    expect(await receiveCsr({ gateway, signer }, SERIAL, await gatewayRequest())).toBe('sent');
    expect((await as('manager', request(app).get('/api/site/gateway'))).body.claim.state).toBe('certified');
  });

  it('refuses requests without the code, and uses the code up once signed', async () => {
    await claim('installer', { qr: gatewayQr(SERIAL, CODE) });
    // Another box with the bootstrap certificate can't ask in this gateway's name.
    expect(await receiveCsr({ gateway, signer }, SERIAL, await gatewayRequest('0'.repeat(20)))).toBe('ignored');
    expect(await receiveCsr({ gateway, signer }, 'EM-GW-UNKNOWN', await gatewayRequest())).toBe('ignored');
    expect(await receiveCsr({ gateway, signer }, SERIAL, { csr: 'nonsense' })).toBe('ignored');

    const first = await gatewayRequest();
    expect(await receiveCsr({ gateway, signer }, SERIAL, first)).toBe('sent');
    // The answer may have been lost: the same request gets the same certificate again.
    expect(await receiveCsr({ gateway, signer }, SERIAL, first)).toBe('sent');
    expect(sent[1].message.cert).toBe(sent[0].message.cert);
    // A new key (a reset gateway) needs a new registration, even with the code.
    expect(await receiveCsr({ gateway, signer }, SERIAL, await gatewayRequest())).toBe('ignored');
    expect(sent).toHaveLength(2);
  });

  it('certifies later when the broker was down', async () => {
    await receiveCsr({ gateway, signer }, SERIAL, await gatewayRequest());
    brokerUp = false;
    expect((await claim('installer', { qr: gatewayQr(SERIAL, CODE) })).body.claim.state).toBe('waiting');
    expect((await Gateway.findOne({ serial: SERIAL }).lean())?.cert).toBeNull();
    brokerUp = true;
    const again = await Gateway.findOne({ serial: SERIAL }).lean();
    expect(await receiveCsr({ gateway, signer }, SERIAL, { csr: again!.csr!.pem, proof: claimProof(claimKey(CODE), again!.csr!.pem!), fw: '0.1.0', ts: new Date().toISOString() })).toBe('sent');
  });

  it('says the same for an unknown serial and a wrong code, and keeps a gateway to one site', async () => {
    const unknown = await claim('installer', { serial: 'EM-GW-999999', code: CODE });
    const wrong = await claim('installer', { serial: SERIAL, code: '0'.repeat(20) });
    expect([unknown.status, wrong.status]).toEqual([404, 404]);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect((await claim('installer', { qr: 'https://example.com/not-a-gateway' })).status).toBe(400);
    expect((await claim('installer', { serial: 'x', code: CODE })).status).toBe(400);
    expect((await claim('manager', { qr: gatewayQr(SERIAL, CODE) })).status).toBe(403);

    expect((await claim('installer', { qr: gatewayQr(SERIAL, CODE) })).status).toBe(200);
    // Claiming again for the same site before it asked is harmless; another site can't take it.
    expect((await claim('owner', { qr: gatewayQr(SERIAL, CODE) })).status).toBe(200);
    const taken = await claim('other', { qr: gatewayQr(SERIAL, CODE) });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/belongs to another site/);
    expect(await AuditEvent.countDocuments({ action: 'gateway.claim' })).toBe(1);

    await receiveCsr({ gateway, signer }, SERIAL, await gatewayRequest());
    expect((await claim('installer', { qr: gatewayQr(SERIAL, CODE) })).body.error.message).toBe('This gateway is already set up for this site.');
  });

  it('shows no claim for a gateway set up another way (the simulator)', async () => {
    await Site.updateOne({ _id: siteId }, { $set: { gatewayId: 'gw-maple-01' } });
    expect((await as('installer', request(app).get('/api/site/gateway'))).body).toMatchObject({ id: 'gw-maple-01', claim: null });
  });
});
