import { Bill, SiteModel, Tariff, assetUrl, recordAudit, type BillDoc, type SiteDoc, type SiteModelDoc, type TariffDoc } from '@ecomanage/db';
import { DEFAULT_SITE_MODEL, dayPrices, siteDate, tariffFromDoc, tariffOn, type Role, type SiteModel as SiteModelView, type SiteModelInput, type SiteToday, type Vec3 } from '@ecomanage/shared';
import { projectedCents } from '../bills/service';

// Home (P4-03): the site's scene model and today's price strip and bill line.

const MONEY: readonly Role[] = ['owner', 'manager'];

/** What a site model version keeps about its uploaded GLB (P5-02); links are built on read. */
export interface StoredUpload {
  uploadId: string;
  assetPrefix: string;
  hasThumb?: boolean | null;
  originalName: string;
  tris?: number | null;
  bytes?: number | null;
  bbox?: { min: number[]; max: number[] } | null;
  scale?: number | null;
}

const uploadView = (u: StoredUpload | null | undefined): SiteModelView['upload'] =>
  u?.assetPrefix
    ? {
        uploadId: u.uploadId,
        glbUrl: assetUrl(`${u.assetPrefix}model.glb`),
        thumbUrl: u.hasThumb ? assetUrl(`${u.assetPrefix}thumb.png`) : null,
        originalName: u.originalName,
        tris: u.tris ?? 0,
        bytes: u.bytes ?? 0,
        bbox: { min: (u.bbox?.min ?? [0, 0, 0]) as Vec3, max: (u.bbox?.max ?? [0, 0, 0]) as Vec3 },
        scale: u.scale ?? 1,
      }
    : null;

/** The latest saved model, or the App v2 demo scene until one is saved. */
export const siteModel = async (site: SiteDoc): Promise<SiteModelView> => {
  const m = await SiteModel.findOne({ siteId: site._id }).sort({ version: -1 }).lean<SiteModelDoc>();
  if (!m) return DEFAULT_SITE_MODEL;
  const upload = m.source === 'upload' ? uploadView(m.upload as StoredUpload | null) : null;
  return {
    version: m.version,
    source: upload ? 'upload' : (m.source as SiteModelView['source']),
    upload,
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

/**
 * Settings → Site model (owner, installer): the edited model becomes the next version (P4-08). An
 * uploaded model stays in use unless `source: 'generated'` switches back (P5-02).
 */
export const saveSiteModel = async (site: SiteDoc, userId: string, input: SiteModelInput): Promise<SiteModelView> => {
  const { source: switchTo, ...rest } = input;
  const latest = await SiteModel.findOne({ siteId: site._id }).sort({ version: -1 }).select('source upload').lean<SiteModelDoc>();
  const keepUpload = !switchTo && latest?.source === 'upload' ? (latest.upload as StoredUpload) : null;
  return saveSiteModelVersion(site, userId, rest, keepUpload ? { source: 'upload', upload: keepUpload } : { source: 'generated', upload: null });
};

/** Writes the next version (two saves at once take the next number) and audits it. */
export const saveSiteModelVersion = async (
  site: SiteDoc,
  userId: string,
  input: Omit<SiteModelInput, 'source'>,
  model: { source: 'generated' | 'upload'; upload: StoredUpload | null }
): Promise<SiteModelView> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await SiteModel.findOne({ siteId: site._id }).sort({ version: -1 }).select('version').lean<{ version: number }>();
    const version = (latest?.version ?? 0) + 1;
    try {
      await SiteModel.create({ siteId: site._id, version, ...model, ...input });
      await recordAudit({ siteId: site._id, userId, action: 'siteModel.update', target: `siteModel:v${version}`, after: { ...input, source: model.source, uploadId: model.upload?.uploadId ?? null } });
      return siteModel(site);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // two saves at once: take the next version
    }
  }
  throw new Error('Could not allocate a site model version');
};
