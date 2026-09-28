import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Device, FleetVehicle, LlmUsage, Membership, Recommendation, recordAudit, type DeviceDoc, type LlmUsageDoc, type RecommendationDoc, type SiteDoc } from '@ecomanage/db';
import { MANUAL_RULE_ID } from '@ecomanage/recs';
import { RECOMMENDATION_RULES, type RecommendationExplanation } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import User from '../auth/model';
import { resolveExplainer, type ExplainDeps } from './llm';

// Optional plain-language explanation of a recommendation (plan P5-05). The model sees only an
// input built here from the server's own proposal: the rule, the device type, the action and its
// settings, the window, the checks, the calculation and the saving. Nothing a person typed goes
// in: not the request, not the title or inputs (they carry device, vehicle and people names), not
// a decline reason; and any name typed on the site that appears in a check or calculation is
// replaced before it is sent. The answer is stored with the hash of its input, so asking again
// costs nothing, and each site has a monthly token budget.

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

// ---- the input ---------------------------------------------------------------------------------

export interface ExplainInput {
  rule: { id: string; title: string };
  device: { type: string };
  action: string;
  settings: Record<string, unknown>;
  window: { start: string; end: string; timeZone: string };
  checks: { text: string; pass: boolean }[];
  calculation: string;
  expectedSaving: { amount: number; currency: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Settings as numbers, booleans, times and lists of those; any other text is left out. */
export const safeSettings = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return ISO.test(value) ? value : undefined;
  if (depth > 3 || value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value.slice(0, 48).map((v) => safeSettings(v, depth + 1)).filter((v) => v !== undefined);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    const s = safeSettings(v, depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every piece of text people typed on this site, with what to say instead: device and vehicle
 * names, RFID tags, the names and addresses of its people, and the site's own name and address.
 */
export const siteNames = async (site: SiteDoc): Promise<[string, string][]> => {
  const [devices, vehicles, members] = await Promise.all([
    Device.find({ siteId: site._id }).select('name type').lean<DeviceDoc[]>(),
    FleetVehicle.find({ siteId: site._id }).select('name rfid').lean<{ name: string; rfid: string }[]>(),
    Membership.find({ siteId: site._id }).select('userId').lean<{ userId: mongoose.Types.ObjectId }[]>(),
  ]);
  const people = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('name email').lean();
  const pairs: [string, string][] = [
    ...devices.map((d): [string, string] => [d.name, `the ${d.type === 'ev' ? 'EV charger' : d.type === 'pv' ? 'solar inverter' : d.type === 'heatpump' ? 'heat pump' : d.type}`]),
    ...vehicles.flatMap((v): [string, string][] => [
      [v.name, 'the vehicle'],
      [v.rfid, 'its RFID tag'],
    ]),
    ...people.flatMap((p): [string, string][] => [
      [p.name ?? '', 'a person'],
      [p.email ?? '', 'a person'],
    ]),
    [site.name, 'the site'],
    [site.address ?? '', 'the site’s address'],
  ];
  // Longest first, so a name that contains another is replaced whole.
  return pairs.filter(([s]) => s.trim().length >= 2).sort((a, b) => b[0].length - a[0].length);
};

export const redact = (text: string, names: [string, string][]): string =>
  names.reduce((t, [name, instead]) => t.replace(new RegExp(escapeRe(name.trim()), 'gi'), instead), text).slice(0, 400);

export const explainInput = (rec: RecommendationDoc, deviceType: string, site: SiteDoc, names: [string, string][]): ExplainInput => ({
  rule: { id: rec.ruleId, title: rec.ruleId === MANUAL_RULE_ID ? 'Manual request' : (RECOMMENDATION_RULES[rec.ruleId as keyof typeof RECOMMENDATION_RULES]?.title ?? 'Recommendation') },
  device: { type: deviceType },
  action: /^[a-z_]{1,40}$/.test(rec.action) ? rec.action : 'change',
  settings: (safeSettings(rec.params ?? {}) as Record<string, unknown>) ?? {},
  window: { start: rec.window.start!.toISOString(), end: rec.window.end!.toISOString(), timeZone: site.tz },
  checks: (rec.checks ?? []).slice(0, 12).map((c) => ({ text: redact(c.text ?? '', names), pass: !!c.pass })),
  calculation: redact(rec.calc ?? '', names),
  expectedSaving: { amount: (rec.expectedSavingCents ?? 0) / 100, currency: site.currency ?? 'CAD' },
});

export const inputHash = (input: ExplainInput): string => createHash('sha256').update(JSON.stringify(input)).digest('hex');

// ---- the endpoint --------------------------------------------------------------------------------

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Tokens the site used this month (input and output). */
export const used = async (site: SiteDoc, now: Date) => {
  const u = await LlmUsage.findOne({ siteId: site._id, month: monthOf(now) }).lean<LlmUsageDoc>();
  return (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
};

export const storedExplanation = (rec: RecommendationDoc): { text: string; model: string; createdAt: string } | null =>
  rec.explanation?.text ? { text: rec.explanation.text, model: rec.explanation.model ?? '', createdAt: rec.explanation.createdAt!.toISOString() } : null;

/** POST /api/recommendations/:id/explain: the stored explanation, or a new one within the budget. */
export const explainRecommendation = async (deps: ExplainDeps | undefined, site: SiteDoc, userId: string, id: string, now = new Date()): Promise<RecommendationExplanation> => {
  const llm = resolveExplainer(deps, site);
  if (!llm) throw fail(503, 'Explanations are off. The owner can plug in a language model in Settings → Rules → Explanations.');
  const rec = mongoose.isValidObjectId(id) ? await Recommendation.findOne({ _id: id, siteId: site._id }).lean<RecommendationDoc>() : null;
  if (!rec) throw fail(404, 'Recommendation not found');
  const device = mongoose.isValidObjectId(rec.deviceId) ? await Device.findOne({ _id: rec.deviceId, siteId: site._id }).select('type').lean<DeviceDoc>() : null;
  const input = explainInput(rec, device?.type ?? 'device', site, await siteNames(site));
  const hash = inputHash(input);
  const budget = async () => ({ usedTokens: await used(site, now), monthlyTokens: llm.monthlyTokens });

  const stored = storedExplanation(rec);
  if (stored && rec.explanation?.inputHash === hash) return { ...stored, cached: true, budget: await budget() };

  if ((await used(site, now)) >= llm.monthlyTokens) throw fail(429, 'This site’s explanations for the month are used up. They start again on the 1st.');
  const result = await llm.explainer(input);
  await LlmUsage.updateOne(
    { siteId: site._id, month: monthOf(now) },
    { $inc: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, requests: 1 } },
    { upsert: true }
  );
  const explanation = { text: result.text, model: result.model, inputHash: hash, createdAt: now };
  await Recommendation.updateOne({ _id: rec._id }, { $set: { explanation } });
  await recordAudit({ siteId: site._id, userId, action: 'recommendation.explain', target: `recommendation:${rec._id}`, after: { model: result.model, source: llm.source, tokens: result.inputTokens + result.outputTokens } });
  return { text: result.text, model: result.model, createdAt: now.toISOString(), cached: false, budget: await budget() };
};
