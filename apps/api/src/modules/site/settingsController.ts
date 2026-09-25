import type { Redis } from 'ioredis';
import { batteryPatch, pvArraysInput, sitePatch } from '@ecomanage/shared';
import { handle, parseBody as body, userIdOf } from '../../lib/http';
import type { GatewayLink } from '../../lib/gatewayLink';
import { rerunForecast, type JobClient } from '../../lib/jobs';
import type { AuthenticatedRequest } from '../../middleware/auth';
import * as settings from './settings';

const FALLBACK = { status: 500, body: { error: { code: 500, message: 'Site settings request failed' } } };
const siteOf = (req: AuthenticatedRequest) => req.site!;

export const settingsController = ({ redis, gateway, jobs }: { redis?: Redis; gateway?: GatewayLink; jobs?: JobClient }) => ({
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
});
