import type { Redis } from 'ioredis';
import { Site, type SiteDoc } from '@ecomanage/db';
import { batteryPatch, gatewayClaimInput, pvArraysInput, sitePatch } from '@ecomanage/shared';
import { claimGateway } from '../gateway/claim';
import type { CertSigner } from '../gateway/signer';
import { handle, parseBody as body, userIdOf } from '../../lib/http';
import type { GatewayLink } from '../../lib/gatewayLink';
import { rerunForecast, type JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as settings from './settings';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Site settings request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

export const settingsController = ({ redis, gateway, jobs, signer }: { redis?: Redis; gateway?: GatewayLink; jobs?: JobClient; signer?: CertSigner }) => ({
  get: handle(FALLBACK, async (req, res) => {
    res.json(await settings.getSettings(siteOf(req)));
  }),
  patch: handle(FALLBACK, async (req, res) => {
    res.json(await settings.updateSite(siteOf(req), userIdOf(req), body(sitePatch, req.body)));
  }),
  pvArrays: handle(FALLBACK, async (req, res) => {
    res.json(await settings.replacePvArrays(siteOf(req), userIdOf(req), body(pvArraysInput, req.body)));
    rerunForecast(jobs, String(siteOf(req)._id)); // the PV forecast uses the arrays
  }),
  battery: handle(FALLBACK, async (req, res) => {
    const { settings: s, gatewaySync } = await settings.updateBattery(siteOf(req), userIdOf(req), body(batteryPatch, req.body), gateway);
    res.json({ ...s, gatewaySync });
  }),
  gateway: handle(FALLBACK, async (req, res) => {
    res.json(await settings.gatewayStatus(siteOf(req), redis));
  }),
  // P5-04: the QR code (or serial and code) of the gateway being installed.
  claim: handle(FALLBACK, async (req, res) => {
    await claimGateway({ gateway, signer }, siteOf(req), userIdOf(req), body(gatewayClaimInput, req.body));
    const site = await Site.findById(siteOf(req)._id).lean<SiteDoc>();
    res.json(await settings.gatewayStatus(site!, redis));
  }),
});
