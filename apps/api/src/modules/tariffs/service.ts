import { Tariff, recordAudit, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import {
  TARIFF_TEMPLATES,
  billingPeriod,
  siteDate,
  tariffOn,
  validateTariff,
  type TariffInput,
  type TariffIssue,
} from '@ecomanage/shared';

export interface TariffView extends TariffInput {
  id: string;
  version: number;
  createdAt: string | null;
}

const toView = (t: TariffDoc): TariffView => ({
  id: String(t._id),
  version: t.version,
  validFrom: t.validFrom,
  name: t.name,
  seasons: (t.seasons ?? []).map((s) => ({ id: s.id!, name: s.name!, fromMonth: s.fromMonth!, toMonth: s.toMonth! })),
  periods: (t.periods ?? []).map((p) => ({
    name: p.name!,
    season: p.season ?? 'all',
    days: p.days as TariffInput['periods'][number]['days'],
    start: p.start!,
    end: p.end!,
    rateCents: p.rateCents!,
  })),
  demandRateCents: t.demandRateCents,
  demandIntervalMin: t.demandIntervalMin as 15 | 30,
  exportRateCents: t.exportRateCents,
  fixedCents: t.fixedCents,
  holidays: { dates: t.holidays?.dates ?? [], treatAs: (t.holidays?.treatAs ?? 'weekend') as 'weekend' | 'weekday' },
  createdAt: (t as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? null,
});

export const listTariffs = async (site: SiteDoc, now = new Date()) => {
  const docs = await Tariff.find({ siteId: site._id }).sort({ version: -1 }).lean<TariffDoc[]>();
  const items = docs.map(toView);
  return { items, current: tariffOn(items, siteDate(now, site.tz))?.version ?? null };
};

export const templates = () => TARIFF_TEMPLATES;

export type CreateResult = { ok: true; tariff: TariffView } | { ok: false; issues: TariffIssue[] };

/**
 * Saves a new version. It must be valid, and must not start before the current billing period:
 * bills for closed periods keep the version they were billed on (plan P2-01).
 */
export const createTariff = async (site: SiteDoc, userId: string, input: TariffInput, now = new Date()): Promise<CreateResult> => {
  const issues = validateTariff(input);
  const period = billingPeriod(now, site.tz, site.billDay ?? 1);
  const periodStart = siteDate(period.start, site.tz);
  if (input.validFrom < periodStart) {
    issues.push({
      kind: 'valid-from',
      message: `Valid from must be on or after ${periodStart}, the start of the current billing period; closed bills keep their tariff`,
    });
  }
  if (issues.length) return { ok: false, issues };

  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await Tariff.findOne({ siteId: site._id }).sort({ version: -1 }).select('version').lean();
    const version = (latest?.version ?? 0) + 1;
    try {
      const doc = await Tariff.create({ ...input, siteId: site._id, version, createdBy: userId });
      const tariff = toView(doc.toObject() as TariffDoc);
      await recordAudit({ siteId: site._id, userId, action: 'tariff.create', target: `tariff:v${version}`, after: tariff });
      return { ok: true, tariff };
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // someone else saved the same version: retry
    }
  }
  throw new Error('Could not allocate a tariff version');
};
