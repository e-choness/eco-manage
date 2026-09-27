import { Bill, SiteModel, Tariff, recordAudit, type BillDoc, type SiteDoc, type SiteModelDoc, type TariffDoc } from '@ecomanage/db';
import { DEFAULT_SITE_MODEL, dayPrices, siteDate, tariffFromDoc, tariffOn, type Role, type SiteModel as SiteModelView, type SiteModelInput, type SiteToday } from '@ecomanage/shared';
import { projectedCents } from '../bills/service';

// Home (P4-03): the site's scene model and today's price strip and bill line.

const MONEY: readonly Role[] = ['owner', 'manager'];

/** The latest saved model, or the App v2 demo scene until one is saved. */
export const siteModel = async (site: SiteDoc): Promise<SiteModelView> => {
  const m = await SiteModel.findOne({ siteId: site._id }).sort({ version: -1 }).lean<SiteModelDoc>();
  if (!m) return DEFAULT_SITE_MODEL;
  return {
    version: m.version,
    source: m.source as SiteModelView['source'],
    hub: m.hub as SiteModelView['hub'],
    anchors: m.anchors.map((a) => ({ key: a.key as SiteModelView['anchors'][number]['key'], at: a.at as SiteModelView['hub'], label: a.label as SiteModelView['hub'] })),
    buildingLabel: m.buildingLabel as SiteModelView['hub'],
    camera: { view: (m.camera?.view ?? 'fit') as SiteModelView['camera']['view'] },
  };
};

/** Today's prices for everyone; the bill so far only for the roles that see money. */
export const siteToday = async (site: SiteDoc, role: Role, now = new Date()): Promise<SiteToday> => {
  const date = siteDate(now, site.tz);
  const tariff = tariffOn(await Tariff.find({ siteId: site._id }).lean<TariffDoc[]>(), date);
  let prices: SiteToday['prices'] = null;
  if (tariff) {
    try {
      prices = dayPrices(tariffFromDoc(tariff), date, site.tz);
    } catch {
      prices = null; // a tariff with a gap today (Settings → Tariff shows the problem)
    }
  }
  let bill: SiteToday['bill'] = null;
  if (MONEY.includes(role)) {
    const b = await Bill.findOne({ siteId: site._id, inProgress: true }).sort({ period: -1 }).lean<BillDoc>();
    if (b) bill = { period: b.period, totalCents: b.totalCents, projectedCents: projectedCents(b, now), savedCents: b.savedCents ?? null };
  }
  return { date, currency: site.currency ?? 'CAD', prices, bill };
};

/** Settings → Site model (owner, installer): the edited model becomes the next version (P4-08). */
export const saveSiteModel = async (site: SiteDoc, userId: string, input: SiteModelInput): Promise<SiteModelView> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await SiteModel.findOne({ siteId: site._id }).sort({ version: -1 }).select('version').lean<{ version: number }>();
    const version = (latest?.version ?? 0) + 1;
    try {
      await SiteModel.create({ siteId: site._id, version, source: 'generated', ...input });
      await recordAudit({ siteId: site._id, userId, action: 'siteModel.update', target: `siteModel:v${version}`, after: input });
      return siteModel(site);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // two saves at once: take the next version
    }
  }
  throw new Error('Could not allocate a site model version');
};
