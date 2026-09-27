import mongoose, { type Types } from 'mongoose';
import { Alert, Bill, Command, Device, Interval15, Recommendation, type SiteDoc } from '@ecomanage/db';
import { ALERT_RULES, REPORT_SECTION_LABEL, endOfLocalDate, siteDateStart, siteLocalIso, type ReportSection } from '@ecomanage/shared';

// What a report says (P5-01): each section as figures and tables, the same for PDF, CSV and XLSX.
// Energy comes from the 15-minute intervals in the site's time; money only when the report's
// creator sees money (owners and managers).

export type Cell = string | number | null;

export type Block =
  | { kind: 'figures'; items: [string, string][] }
  | { kind: 'table'; title: string; head: string[]; rows: Cell[][]; digits?: (number | null)[] }
  | { kind: 'note'; text: string };

export interface ReportSectionOut {
  id: ReportSection;
  title: string;
  blocks: Block[];
}

export interface ReportDocument {
  title: string;
  siteName: string;
  address: string | null;
  from: string;
  to: string;
  tz: string;
  currency: string;
  generatedAt: Date;
  notes: string;
  sections: ReportSectionOut[];
}

export interface ReportInput {
  site: Pick<SiteDoc, 'name' | 'tz' | 'currency' | 'demandCapKw'> & { _id: Types.ObjectId; address?: string | null };
  name: string;
  from: string;
  to: string;
  sections: ReportSection[];
  notes: string;
  money: boolean;
  now: Date;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const kwh = (x: number) => `${r1(x).toLocaleString('en-US')} kWh`;
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const moneyText = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(Math.round(cents) === 0 ? 0 : cents / 100).replace('−', '-'); // never "-$0.00"
/** "2026-09-24 15:15" in the site's zone. */
const localTime = (at: Date | null | undefined, tz: string) => (at ? siteLocalIso(at, tz).slice(0, 16).replace('T', ' ') : '—');

interface Sums {
  pv: number;
  used: number;
  battOut: number;
  battIn: number;
  grid: number;
  export: number;
  bld: number;
  hp: number;
  ev: number;
  pk: number;
  md: number;
  op: number;
  credit: number;
  est: number;
  n: number;
}

const SUM_FIELDS = {
  pv: { $sum: '$pv' },
  used: { $sum: '$used' },
  battOut: { $sum: { $max: ['$batt', 0] } },
  battIn: { $sum: { $max: [{ $multiply: ['$batt', -1] }, 0] } },
  grid: { $sum: '$grid' },
  export: { $sum: '$export' },
  bld: { $sum: '$bld' },
  hp: { $sum: '$hp' },
  ev: { $sum: '$ev' },
  pk: { $sum: '$costCents.pk' },
  md: { $sum: '$costCents.md' },
  op: { $sum: '$costCents.op' },
  credit: { $sum: '$creditCents' },
  est: { $sum: { $cond: [{ $eq: ['$quality', 'estimated'] }, 1, 0] } },
  n: { $sum: 1 },
};

const EMPTY: Sums = { pv: 0, used: 0, battOut: 0, battIn: 0, grid: 0, export: 0, bld: 0, hp: 0, ev: 0, pk: 0, md: 0, op: 0, credit: 0, est: 0, n: 0 };
const consumption = (s: Sums) => s.bld + s.hp + s.ev;

/** Builds the report from the database. `from` and `to` are local dates, both included. */
export const reportContent = async (input: ReportInput): Promise<ReportDocument> => {
  const { site, from, to, money, now } = input;
  const tz = site.tz;
  const currency = site.currency || 'USD';
  const start = siteDateStart(from, tz);
  const end = endOfLocalDate(to, tz);
  const span = { $gte: start, $lt: end };
  const match = { siteId: site._id, start: span };
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const m = (cents: number) => moneyText(cents, currency);

  const [total = EMPTY] = await Interval15.aggregate<Sums>([{ $match: match }, { $group: { _id: null, ...SUM_FIELDS } }]);
  const peaks = await Interval15.find({ ...match, demandKw: { $gt: 0 } }).sort({ demandKw: -1, start: 1 }).limit(10).select('start demandKw').lean<{ start: Date; demandKw: number }[]>();

  const sections: ReportSectionOut[] = [];
  for (const id of input.sections) {
    const blocks: Block[] = [];
    if (id === 'summary') {
      const use = consumption(total);
      blocks.push({
        kind: 'figures',
        items: [
          ['Consumption', kwh(use)],
          ['Solar produced', kwh(total.pv)],
          ['Solar used on site', kwh(total.used)],
          ['Bought from the grid', kwh(total.grid)],
          ['Sent to the grid', kwh(total.export)],
          ['Self-sufficiency', pct(use > 0 ? Math.max(0, use - total.grid) / use : null)],
          ['Highest 15-min demand', peaks[0] ? `${r1(peaks[0].demandKw)} kW · ${localTime(peaks[0].start, tz)}` : '—'],
          ...(money ? ([['Energy cost', m(total.pk + total.md + total.op - total.credit)]] as [string, string][]) : []),
        ],
      });
      if (total.est) blocks.push({ kind: 'note', text: `${total.est} of ${total.n} 15-minute intervals are estimated (missing readings filled in).` });
      if (!total.n) blocks.push({ kind: 'note', text: 'No readings in this period.' });
    }

    if (id === 'sources') {
      // Daily rows for up to two months, monthly ones beyond.
      const unit = days <= 62 ? 'day' : 'month';
      const rows = await Interval15.aggregate<Sums & { _id: Date }>([
        { $match: match },
        { $group: { _id: { $dateTrunc: { date: '$start', unit, timezone: tz } }, ...SUM_FIELDS } },
        { $sort: { _id: 1 } },
      ]);
      const line = (label: string, s: Sums): Cell[] => [label, s.pv, s.battOut, s.grid, s.export, s.bld, s.hp, s.ev].map((c) => (typeof c === 'number' ? r1(c) : c));
      blocks.push({
        kind: 'table',
        title: unit === 'day' ? 'By day (kWh)' : 'By month (kWh)',
        head: [unit === 'day' ? 'Date' : 'Month', 'Solar', 'Battery out', 'Grid', 'Export', 'Building', 'Heat pump', 'EV'],
        rows: [...rows.map((r) => line(siteLocalIso(r._id, tz).slice(0, unit === 'day' ? 10 : 7), r)), line('Total', total)],
        digits: [null, 1, 1, 1, 1, 1, 1, 1],
      });
      blocks.push({ kind: 'figures', items: [['Battery charged', kwh(total.battIn)], ['Battery discharged', kwh(total.battOut)]] });
    }

    if (id === 'demand') {
      const cap = site.demandCapKw ?? null;
      const months = await Interval15.aggregate<{ _id: Date; kw: number }>([
        { $match: match },
        { $group: { _id: { $dateTrunc: { date: '$start', unit: 'month', timezone: tz } }, kw: { $max: '$demandKw' } } },
        { $sort: { _id: 1 } },
      ]);
      const near = cap ? await Interval15.countDocuments({ ...match, demandKw: { $gte: cap * 0.9 } }) : null;
      blocks.push({
        kind: 'figures',
        items: [
          ['Demand cap', cap ? `${cap} kW` : 'not set'],
          ['Highest 15-min demand', peaks[0] ? `${r1(peaks[0].demandKw)} kW` : '—'],
          ...(cap ? ([['Intervals at 90% of the cap or more', String(near)]] as [string, string][]) : []),
        ],
      });
      blocks.push({ kind: 'table', title: 'Highest 15-minute intervals', head: ['Interval start', 'Demand (kW)'], rows: peaks.map((p) => [localTime(p.start, tz), r1(p.demandKw)]), digits: [null, 1] });
      if (months.length > 1) blocks.push({ kind: 'table', title: 'Peak by month', head: ['Month', 'Peak (kW)'], rows: months.map((x) => [siteLocalIso(x._id, tz).slice(0, 7), r1(x.kw)]), digits: [null, 1] });
    }

    if (id === 'cost') {
      if (!money) blocks.push({ kind: 'note', text: 'Energy cost is only included in reports made by the owner or a manager.' });
      else {
        blocks.push({
          kind: 'table',
          title: `Energy in this period (${currency})`,
          head: ['Line', 'Amount'],
          rows: [
            ['Energy - peak', m(total.pk)],
            ['Energy - mid', m(total.md)],
            ['Energy - off-peak', m(total.op)],
            ['Export credit', m(-total.credit)],
            ['Energy total', m(total.pk + total.md + total.op - total.credit)],
          ],
        });
        // Demand and fixed charges are monthly, so they come from the bills that overlap the period.
        const bills = await Bill.find({ siteId: site._id, start: { $lt: end }, end: { $gt: start } }).sort({ period: 1 }).lean();
        if (bills.length)
          blocks.push({
            kind: 'table',
            title: 'Bills overlapping this period',
            head: ['Period', 'Energy', 'Demand', 'Fixed', 'Export credit', 'Total', 'Peak (kW)'],
            rows: bills.map((b) => {
              const l = b.lines!;
              return [
                b.period + (b.inProgress ? ' (in progress)' : ''),
                m(l.energyPkCents + l.energyMdCents + l.energyOpCents),
                m(l.demandCents),
                m(l.fixedCents),
                m(-l.exportCreditCents),
                m(b.totalCents),
                r1(b.peakKw),
              ];
            }),
            digits: [null, null, null, null, null, null, 1],
          });
      }
    }

    if (id === 'devices') {
      const devices = await Device.find({ siteId: site._id }).sort({ type: 1, name: 1 }).lean();
      // Downtime: "Device not reporting" alerts overlapping the period, clipped to it.
      const silent = await Alert.find({ siteId: site._id, ruleId: 'device-silent', openedAt: { $lt: end }, $or: [{ resolvedAt: null }, { resolvedAt: { $gt: start } }] })
        .select('deviceId openedAt resolvedAt')
        .lean();
      const until = Math.min(end.getTime(), now.getTime());
      const seconds = Math.max(0, until - start.getTime()) / 1000;
      const down = new Map<string, number>();
      for (const a of silent) {
        const s = Math.max(a.openedAt.getTime(), start.getTime());
        const e = Math.min(a.resolvedAt?.getTime() ?? until, until);
        if (e > s && a.deviceId) down.set(a.deviceId, (down.get(a.deviceId) ?? 0) + (e - s) / 1000);
      }
      blocks.push({
        kind: 'table',
        title: 'Availability',
        head: ['Device', 'Type', 'Status now', 'Not reporting (h)', 'Available'],
        rows: devices.map((d) => {
          const off = down.get(String(d._id)) ?? 0;
          return [d.name, d.type, d.status, r1(off / 3600), pct(seconds > 0 ? 1 - off / seconds : null)];
        }),
        digits: [null, null, null, 1, null],
      });
    }

    if (id === 'decisions') {
      const recs = await Recommendation.find({ siteId: site._id, proposedAt: span }).sort({ proposedAt: 1 }).lean();
      const counts = new Map<string, number>();
      for (const r of recs) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      const measured = recs.reduce((s, r) => s + (r.actualSavingCents ?? 0), 0);
      blocks.push({
        kind: 'figures',
        items: [
          ['Proposed', String(recs.length)],
          ['Approved and carried out', String(['approved', 'sent', 'acked', 'verified', 'reverted'].reduce((s, k) => s + (counts.get(k) ?? 0), 0))],
          ['Declined', String(counts.get('declined') ?? 0)],
          ['Expired', String(counts.get('expired') ?? 0)],
          ...(money ? ([['Measured saving', m(measured)]] as [string, string][]) : []),
        ],
      });
      blocks.push({
        kind: 'table',
        title: 'Recommendations',
        head: ['Proposed', 'Rule', 'Action', 'Status', ...(money ? ['Expected saving', 'Measured saving'] : [])],
        rows: recs.map((r) => [
          localTime(r.proposedAt, tz),
          r.ruleId,
          r.title,
          r.status,
          ...(money ? [m(r.expectedSavingCents), r.actualSavingCents == null ? '—' : m(r.actualSavingCents)] : []),
        ]),
      });
      const commands = await Command.find({ siteId: site._id, createdAt: span }).sort({ createdAt: 1 }).lean<{ createdAt: Date; deviceId: string; action: string; status: string; error?: string | null }[]>();
      const names = await deviceNames(site._id, commands.map((c) => c.deviceId));
      blocks.push({
        kind: 'table',
        title: 'Commands',
        head: ['Created', 'Device', 'Action', 'Status', 'Error'],
        rows: commands.map((c) => [localTime(c.createdAt, tz), names.get(c.deviceId) ?? c.deviceId, c.action, c.status, c.error ?? '']),
      });
    }

    if (id === 'alerts') {
      const alerts = await Alert.find({ siteId: site._id, openedAt: span }).sort({ openedAt: 1 }).lean();
      const names = await deviceNames(site._id, alerts.map((a) => a.deviceId).filter((d): d is string => !!d));
      blocks.push({
        kind: 'figures',
        items: [
          ['Opened', String(alerts.length)],
          ['Critical or warning', String(alerts.filter((a) => a.severity !== 'info').length)],
          ['Still open', String(alerts.filter((a) => a.state !== 'resolved').length)],
        ],
      });
      blocks.push({
        kind: 'table',
        title: 'Alerts opened',
        head: ['Opened', 'Severity', 'Alert', 'Device', 'State', 'Closed', 'Cause'],
        rows: alerts.map((a) => [
          localTime(a.openedAt, tz),
          a.severity,
          a.title || ALERT_RULES[a.ruleId as keyof typeof ALERT_RULES]?.title || a.ruleId,
          a.deviceId ? (names.get(a.deviceId) ?? a.deviceId) : 'Site',
          a.state,
          localTime(a.resolvedAt, tz),
          a.resolution?.cause ?? (a.resolution?.auto ? 'Cleared by itself' : ''),
        ]),
      });
    }

    sections.push({ id, title: REPORT_SECTION_LABEL[id], blocks });
  }

  return { title: input.name, siteName: site.name, address: site.address ?? null, from, to, tz, currency, generatedAt: now, notes: input.notes, sections };
};

const deviceNames = async (siteId: Types.ObjectId, ids: string[]): Promise<Map<string, string>> => {
  const valid = [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id));
  if (!valid.length) return new Map();
  const devices = await Device.find({ siteId, _id: { $in: valid } }).select('name').lean();
  return new Map(devices.map((d) => [String(d._id), d.name]));
};
