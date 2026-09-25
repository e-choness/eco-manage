import type { Types } from 'mongoose';
import { Bill, Interval15, Site, Tariff, type BillDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import {
  SAVINGS_MIN_INTERVALS,
  billingPeriod,
  computeBill,
  costInterval,
  tariffFromDoc,
  type IntervalLike,
  type Tariff as TariffShape,
} from '@ecomanage/shared';

// Stores interval costs and bills (plan P2-03). The pricing itself is pure and lives in
// @ecomanage/shared (billing.ts), so the API prices custom ranges the same way.

export { bucketOf, computeBill, costInterval } from '@ecomanage/shared';

const loadTariffs = async (siteId: Types.ObjectId | string): Promise<TariffShape[]> =>
  (await Tariff.find({ siteId }).lean<TariffDoc[]>()).map(tariffFromDoc);

/** Recomputes and stores the bill for the billing period that contains `at`. */
export const refreshBill = async (site: SiteDoc, at: Date, now = new Date()): Promise<BillDoc> => {
  const period = billingPeriod(at, site.tz, site.billDay ?? 1);
  const [intervals, tariffs, history] = await Promise.all([
    Interval15.find({ siteId: site._id, start: { $gte: period.start, $lt: period.end } })
      .select('start grid export pv batt demandKw quality')
      .lean<IntervalLike[]>(),
    loadTariffs(site._id),
    Interval15.countDocuments({ siteId: site._id, start: { $lt: now } }, { limit: SAVINGS_MIN_INTERVALS }),
  ]);
  const bill = computeBill(period, intervals, tariffs, site.tz, now, history >= SAVINGS_MIN_INTERVALS);
  // The comparison with the utility's total follows our total when late data changes it.
  const saved = (await Bill.findOneAndUpdate(
    { siteId: site._id, period: bill.period },
    [
      { $set: { ...bill, computedAt: now } },
      {
        $set: {
          utility: {
            $cond: [
              { $ne: [{ $ifNull: ['$utility.totalCents', null] }, null] },
              { $mergeObjects: ['$utility', { diffCents: { $subtract: [bill.totalCents, '$utility.totalCents'] } }] },
              { $ifNull: ['$utility', null] },
            ],
          },
        },
      },
    ],
    { upsert: true, new: true }
  ).lean<BillDoc>())!;
  return saved;
};

/**
 * Prices every interval that has no cost yet (new or recomputed by ingest), then refreshes the
 * bills of the periods they belong to. Returns how many intervals were priced.
 */
export const costPendingIntervals = async (now = new Date(), limit = 5000): Promise<number> => {
  const pending = await Interval15.find({ costedAt: null }).sort({ start: 1 }).limit(limit).lean();
  if (pending.length === 0) return 0;
  const bySite = new Map<string, typeof pending>();
  for (const iv of pending) {
    const list = bySite.get(String(iv.siteId)) ?? [];
    list.push(iv);
    bySite.set(String(iv.siteId), list);
  }
  for (const [siteId, list] of bySite) {
    const site = await Site.findById(siteId).lean<SiteDoc>();
    if (!site) {
      // Orphaned rows would otherwise be picked up again on every pass.
      await Interval15.updateMany({ _id: { $in: list.map((iv) => iv._id) } }, { $set: { costedAt: now } });
      continue;
    }
    const tariffs = await loadTariffs(siteId);
    await Interval15.bulkWrite(
      list.map((iv) => {
        const c = costInterval(iv as unknown as IntervalLike, tariffs, site.tz);
        // Only mark it costed if nobody recomputed the interval in the meantime.
        return { updateOne: { filter: { _id: iv._id, updatedAt: iv.updatedAt }, update: { $set: { ...c, costedAt: now } } } };
      })
    );
    const periods = new Map<string, Date>();
    for (const iv of list) periods.set(billingPeriod(iv.start, site.tz, site.billDay ?? 1).period, iv.start);
    for (const at of periods.values()) await refreshBill(site, at, now);
  }
  return pending.length;
};

/** Nightly: recompute the current and the previous period of every site whose local hour is `hour`. */
export const nightlyBills = async (now = new Date(), hour = 1): Promise<number> => {
  let done = 0;
  for (const site of await Site.find().lean<SiteDoc[]>()) {
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: site.tz }).format(now));
    if (localHour !== hour) continue;
    const current = billingPeriod(now, site.tz, site.billDay ?? 1);
    await refreshBill(site, now, now);
    await refreshBill(site, new Date(current.start.getTime() - 1), now);
    done++;
  }
  return done;
};
