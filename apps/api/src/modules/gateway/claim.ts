import mongoose from 'mongoose';
import { Gateway, Site, recordAudit, type GatewayDoc, type SiteDoc } from '@ecomanage/db';
import { claimCsrMessage, parseGatewayQr, type GatewayClaimInput } from '@ecomanage/shared';
import { codeMatches, proofMatches } from '@ecomanage/shared/claim-proof';
import type { Logger } from 'pino';
import { HttpError } from '../../lib/http';
import type { GatewayLink } from '../../lib/gatewayLink';
import type { CertSigner } from './signer';

// Claiming a gateway (P5-04, Data and Device Audit §4 step 01). The installer enters the QR code
// (or serial and code) for a site; the gateway's certificate request, which proves it knows the
// code, is signed with CN = the site id and sent back over its bootstrap connection. Signing
// uses the code up: a gateway that has been reset needs a new registration.

export interface ClaimDeps {
  gateway?: GatewayLink;
  signer?: CertSigner;
  logger?: Pick<Logger, 'info' | 'warn'>;
}

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

/** Signs the stored request and sends the certificate. False when it can't be sent right now. */
const issue = async ({ gateway, signer, logger }: ClaimDeps, gw: GatewayDoc): Promise<boolean> => {
  if (!gw.siteId || !gw.csr?.pem || !signer || !gateway?.sendClaimCert) return false;
  const siteId = String(gw.siteId);
  const cert = gw.cert?.pem ? { pem: gw.cert.pem, serialNumber: gw.cert.serialNumber!, notAfter: gw.cert.notAfter! } : await signer.sign(gw.csr.pem, siteId);
  const sent = await gateway.sendClaimCert(gw.serial, { siteId, cert: cert.pem, ca: signer.caPem, ts: new Date().toISOString() });
  if (!sent) return false;
  if (!gw.cert?.pem) {
    await Gateway.updateOne({ _id: gw._id }, { $set: { cert: { serialNumber: cert.serialNumber, pem: cert.pem, issuedAt: new Date(), notAfter: cert.notAfter } } });
    await recordAudit({ siteId: gw.siteId, userId: null, action: 'gateway.certificate', target: `gateway:${gw.serial}`, after: { serialNumber: cert.serialNumber, notAfter: cert.notAfter } });
    logger?.info({ serial: gw.serial, siteId }, 'gateway certificate issued');
  }
  return true;
};

/**
 * A certificate request from a gateway (claim/{serial}/csr). Ignored unless it proves the code;
 * kept until the gateway is claimed, then answered. Asking again with the same request after
 * the certificate was issued gets the same certificate (the answer may have been lost).
 */
export const receiveCsr = async (deps: ClaimDeps, serial: string, payload: unknown): Promise<'ignored' | 'waiting' | 'sent' | 'unsent'> => {
  const msg = claimCsrMessage.safeParse(payload);
  if (!msg.success) return 'ignored';
  const gw = await Gateway.findOne({ serial }).lean<GatewayDoc>();
  if (!gw || !proofMatches(gw.claimKey, msg.data.csr, msg.data.proof)) {
    deps.logger?.warn({ serial }, 'certificate request without a valid claim proof');
    return 'ignored';
  }
  if (gw.cert?.pem) {
    // Used up: only the request it was issued for gets it again.
    if (gw.csr?.pem !== msg.data.csr) return 'ignored';
    return (await issue(deps, gw)) ? 'sent' : 'unsent';
  }
  const updated = await Gateway.findOneAndUpdate({ _id: gw._id }, { $set: { csr: { pem: msg.data.csr, fw: msg.data.fw, at: new Date() } } }, { new: true }).lean<GatewayDoc>();
  if (!updated?.siteId) return 'waiting';
  return (await issue(deps, updated)) ? 'sent' : 'unsent';
};

/** POST /api/site/gateway/claim: binds the gateway to this site and, if it has asked, certifies it. */
export const claimGateway = async (deps: ClaimDeps, site: SiteDoc, userId: string, input: GatewayClaimInput): Promise<{ serial: string; certified: boolean }> => {
  const parsed = 'qr' in input ? parseGatewayQr(input.qr) : input;
  if (!parsed) throw fail(400, 'That QR code isn’t from an EcoManage gateway. Type the serial number and claim code instead.');
  const gw = await Gateway.findOne({ serial: parsed.serial }).lean<GatewayDoc>();
  // One answer for an unknown serial and a wrong code, so serials can't be probed.
  if (!gw || !codeMatches(gw.claimKey, parsed.code)) throw fail(404, 'No gateway has that serial number and claim code. Check both on the label.');
  const here = gw.siteId && String(gw.siteId) === String(site._id);
  if (gw.siteId && !here) throw fail(409, 'This gateway belongs to another site. It has to be reset and registered again before it can move.');
  if (gw.cert?.pem) throw fail(409, 'This gateway is already set up for this site.');

  const claimed = here
    ? gw
    : await Gateway.findOneAndUpdate(
        { _id: gw._id, siteId: null },
        { $set: { siteId: site._id, claimedAt: new Date(), claimedBy: new mongoose.Types.ObjectId(userId) } },
        { new: true }
      ).lean<GatewayDoc>();
  if (!claimed) throw fail(409, 'This gateway was just claimed for another site.');
  if (!here) {
    const before = site.gatewayId ?? null;
    await Site.updateOne({ _id: site._id }, { $set: { gatewayId: gw.serial } });
    await recordAudit({ siteId: site._id, userId, action: 'gateway.claim', target: `gateway:${gw.serial}`, before: { gatewayId: before }, after: { gatewayId: gw.serial } });
  }
  return { serial: gw.serial, certified: await issue(deps, claimed) };
};

/** Where the site's gateway is in the claim: waiting for it to ask, or certified (null if none is registered). */
export const claimState = async (site: SiteDoc): Promise<{ serial: string; state: 'waiting' | 'certified'; claimedAt: string | null } | null> => {
  if (!site.gatewayId) return null;
  const gw = await Gateway.findOne({ serial: site.gatewayId, siteId: site._id }).lean<GatewayDoc>();
  if (!gw) return null; // a gateway set up before claiming existed (the simulator)
  return { serial: gw.serial, state: gw.cert?.pem ? 'certified' : 'waiting', claimedAt: gw.claimedAt?.toISOString() ?? null };
};
