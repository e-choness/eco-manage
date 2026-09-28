import { Export, Interval15, Site, putFile, type ExportDoc, type Interval15Doc, type SiteDoc } from '@ecomanage/db';
import { endOfSiteDay, siteDateStart, siteLocalIso, type DocumentJobs, type ExportJob } from '@ecomanage/shared';

// History → Export CSV (P4-05): every 15-minute interval of a range, in the site's time. Cost
// columns only for the roles that see money. The file goes to the file store; the API serves it.

const n3 = (x: number | null | undefined) => (x ?? 0).toFixed(3);
const money = (cents: number) => (cents / 100).toFixed(2);

const csvHeader = (includeCost: boolean, currency: string): string =>
  [
    'local_start',
    'utc_start',
    'solar_kwh',
    'solar_used_kwh',
    'battery_kwh',
    'grid_import_kwh',
    'export_kwh',
    'building_kwh',
    'heat_pump_kwh',
    'ev_kwh',
    'demand_kw',
    ...(includeCost ? [`energy_cost_${currency.toLowerCase()}`, `export_credit_${currency.toLowerCase()}`] : []),
    'quality',
  ].join(',');

const csvRow = (iv: Interval15Doc, tz: string, includeCost: boolean): string =>
  [
    siteLocalIso(iv.start, tz),
    iv.start.toISOString(),
    n3(iv.pv),
    n3(iv.used),
    n3(iv.batt), // + discharge into the site, − charge
    n3(iv.grid),
    n3(iv.export),
    n3(iv.bld),
    n3(iv.hp),
    n3(iv.ev),
    (iv.demandKw ?? 0).toFixed(1),
    ...(includeCost ? [money((iv.costCents?.pk ?? 0) + (iv.costCents?.md ?? 0) + (iv.costCents?.op ?? 0)), money(iv.creditCents ?? 0)] : []),
    iv.quality ?? 'ok',
  ].join(',');

export const exportCsvJob = async ({ exportId }: ExportJob): Promise<DocumentJobs['export-csv']['result']> => {
  const e = await Export.findById(exportId).lean<ExportDoc>();
  if (!e) return { rows: 0 };
  try {
    const site = await Site.findById(e.siteId).lean<SiteDoc>();
    if (!site) throw new Error('The site no longer exists');
    const tz = site.tz;
    const lines = [csvHeader(e.includeCost, site.currency ?? 'CAD')];
    const cursor = Interval15.find({ siteId: e.siteId, start: { $gte: siteDateStart(e.from, tz), $lt: endOfSiteDay(siteDateStart(e.to, tz), tz) } })
      .sort({ start: 1 })
      .lean<Interval15Doc[]>()
      .cursor();
    for await (const iv of cursor) lines.push(csvRow(iv as Interval15Doc, tz, e.includeCost));
    const rows = lines.length - 1;
    const fileId = await putFile(`energy-${e.from}-to-${e.to}.csv`, Buffer.from(`${lines.join('\n')}\n`), {
      siteId: String(e.siteId),
      kind: 'export',
      contentType: 'text/csv',
      exportId,
    });
    await Export.updateOne({ _id: e._id }, { $set: { status: 'done', fileId, rows, error: null } });
    return { rows };
  } catch (err) {
    await Export.updateOne({ _id: e._id }, { $set: { status: 'failed', error: (err as Error).message } });
    throw err;
  }
};
