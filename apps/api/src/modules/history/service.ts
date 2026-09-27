import type { PipelineStage } from 'mongoose';
import { Interval15, type SiteDoc } from '@ecomanage/db';
import {
  bucketStarts,
  compareRange,
  endOfSiteDay,
  resolveRange,
  siteDate,
  siteDateStart,
  type HistoryBucket,
  type HistoryQuery,
  type HistoryRes,
  type HistorySeries,
  type HistoryTotals,
  type HistoryTotalsResponse,
  type Role,
  type TotalsQuery,
} from '@ecomanage/shared';

// History (P4-05): the 15-minute intervals summed per bucket in the site's time zone, and totals
// for a range and the range it is compared with. Installers get no money (plan §1).

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const seesMoney = (role: Role) => role === 'owner' || role === 'manager';

/** First local date with data (today if there is none yet) and today, in the site's zone. */
const dataBounds = async (site: SiteDoc, now: Date) => {
  const first = await Interval15.findOne({ siteId: site._id }).sort({ start: 1 }).select('start').lean<{ start: Date }>();
  const today = siteDate(now, site.tz);
  return { dataStart: first ? siteDate(first.start, site.tz) : today, today };
};

const localSpan = (site: SiteDoc, from: string, to: string) => ({
  $gte: siteDateStart(from, site.tz),
  $lt: endOfSiteDay(siteDateStart(to, site.tz), site.tz),
});

const TRUNC: Record<HistoryRes, Record<string, unknown>> = {
  '15m': { unit: 'minute', binSize: 15 },
  h: { unit: 'hour' },
  d: { unit: 'day' },
  w: { unit: 'week', startOfWeek: 'monday' },
  mo: { unit: 'month' },
};

type Row = Omit<HistoryBucket, 'start' | 'estimated' | 'costCents'> & { _id: Date; cost: number; est: number };

export const historySeries = async (site: SiteDoc, role: Role, q: HistoryQuery, now = new Date()): Promise<HistorySeries> => {
  const { dataStart, today } = await dataBounds(site, now);
  const range = resolveRange(q, dataStart, today);
  const pipeline: PipelineStage[] = [
    { $match: { siteId: site._id, start: localSpan(site, range.from, range.to) } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$start', timezone: site.tz, ...TRUNC[range.res] } },
        pv: { $sum: '$pv' },
        used: { $sum: '$used' },
        batt: { $sum: { $max: ['$batt', 0] } },
        grid: { $sum: '$grid' },
        export: { $sum: '$export' },
        bld: { $sum: '$bld' },
        hp: { $sum: '$hp' },
        ev: { $sum: '$ev' },
        peakKw: { $max: '$demandKw' },
        cost: { $sum: { $add: ['$costCents.pk', '$costCents.md', '$costCents.op'] } },
        est: { $max: { $cond: [{ $eq: ['$quality', 'estimated'] }, 1, 0] } },
        n: { $sum: 1 },
      },
    },
  ];
  const rows = new Map((await Interval15.aggregate<Row>(pipeline)).map((r) => [r._id.toISOString(), r]));
  const money = seesMoney(role);
  const buckets = bucketStarts(range.from, range.to, range.res, site.tz).map((start): HistoryBucket => {
    const r = rows.get(start);
    return {
      start,
      pv: round3(r?.pv ?? 0),
      used: round3(r?.used ?? 0),
      batt: round3(r?.batt ?? 0),
      grid: round3(r?.grid ?? 0),
      export: round3(r?.export ?? 0),
      bld: round3(r?.bld ?? 0),
      hp: round3(r?.hp ?? 0),
      ev: round3(r?.ev ?? 0),
      peakKw: Math.round((r?.peakKw ?? 0) * 10) / 10,
      costCents: money ? Math.round(r?.cost ?? 0) : null,
      estimated: (r?.est ?? 0) > 0,
      n: r?.n ?? 0,
    };
  });
  return { ...range, dataStart, today, buckets };
};

const totalsFor = async (site: SiteDoc, money: boolean, from: string, to: string): Promise<HistoryTotals | null> => {
  const match = { siteId: site._id, start: localSpan(site, from, to) };
  const [[sum], peak] = await Promise.all([
    Interval15.aggregate<{ pv: number; grid: number; export: number; cost: number; est: number; n: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          pv: { $sum: '$pv' },
          grid: { $sum: '$grid' },
          export: { $sum: '$export' },
          cost: { $sum: { $add: ['$costCents.pk', '$costCents.md', '$costCents.op'] } },
          est: { $sum: { $cond: [{ $eq: ['$quality', 'estimated'] }, 1, 0] } },
          n: { $sum: 1 },
        },
      },
    ]),
    Interval15.findOne(match).sort({ demandKw: -1, start: 1 }).select('start demandKw').lean<{ start: Date; demandKw: number }>(),
  ]);
  if (!sum) return null;
  return {
    pvKwh: round3(sum.pv),
    gridKwh: round3(sum.grid),
    exportKwh: round3(sum.export),
    peak: peak ? { kw: Math.round(peak.demandKw * 10) / 10, at: peak.start.toISOString() } : null,
    costCents: money ? Math.round(sum.cost) : null,
    estimatedIntervals: sum.est,
    intervals: sum.n,
  };
};

const EMPTY: HistoryTotals = { pvKwh: 0, gridKwh: 0, exportKwh: 0, peak: null, costCents: 0, estimatedIntervals: 0, intervals: 0 };

export const historyTotals = async (site: SiteDoc, role: Role, q: TotalsQuery, now = new Date()): Promise<HistoryTotalsResponse> => {
  const { dataStart, today } = await dataBounds(site, now);
  const range = resolveRange({ from: q.from, to: q.to, res: 'd' }, dataStart, today);
  const money = seesMoney(role);
  const totals = (await totalsFor(site, money, range.from, range.to)) ?? { ...EMPTY, costCents: money ? 0 : null };
  let compare: HistoryTotalsResponse['compare'] = null;
  if (q.compare !== 'none') {
    const c = compareRange(range.from, range.to, q.compare);
    // Before the first data there is nothing to compare with.
    compare = { ...c, totals: c.to < dataStart ? null : await totalsFor(site, money, c.from < dataStart ? dataStart : c.from, c.to) };
  }
  return { from: range.from, to: range.to, totals, compare };
};
