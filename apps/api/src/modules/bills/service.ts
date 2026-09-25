import type { Readable } from 'node:stream';
import { Bill, Interval15, Tariff, fileInfo, openFile, putFile, recordAudit, type BillDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import { computeBill, siteDateStart, tariffFromDoc, type IntervalLike } from '@ecomanage/shared';
import { HttpError } from '../../lib/http';
import { JobTimeout, type JobClient } from '../../lib/jobs';

// Bills (plan P2-05, Backend Coverage §Bills). The worker computes and stores them; this module
// reads them, prices custom ranges on the fly, and hands statements and utility bills to the worker.

const DAY_MS = 86_400_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const MAX_RANGE_DAYS = 366;

const fail = (status: number, message: string) => new HttpError(status, { error: { code: status, message } });

const energyOf = (b: Pick<BillDoc, 'lines'>) => b.lines!.energyPkCents + b.lines!.energyMdCents + b.lines!.energyOpCents;

/** Local days in the period, and days so far for an open one (DST days still count as one). */
const daysOf = (b: Pick<BillDoc, 'start' | 'end' | 'inProgress'>, now: Date) => {
  const total = Math.round((b.end.getTime() - b.start.getTime()) / DAY_MS);
  const elapsed = b.inProgress ? Math.min(total, Math.floor((now.getTime() - b.start.getTime()) / DAY_MS) + 1) : total;
  return { elapsed, total };
};

/**
 * Where an open period is heading: energy and export credit so far scaled to the whole period,
 * plus the demand charge at today's peak and the fixed fee (both are charged once).
 */
export const projectedCents = (b: Pick<BillDoc, 'start' | 'end' | 'inProgress' | 'lines'>, now: Date): number | null => {
  if (!b.inProgress) return null;
  const share = Math.min(1, Math.max(0, (now.getTime() - b.start.getTime()) / (b.end.getTime() - b.start.getTime())));
  if (share <= 0) return null;
  const l = b.lines!;
  return Math.round((energyOf(b) - l.exportCreditCents) / share) + l.demandCents + l.fixedCents;
};

const utilityView = (u: BillDoc['utility']) =>
  u
    ? {
        status: u.status,
        totalCents: u.totalCents ?? null,
        diffCents: u.diffCents ?? null,
        source: u.source ?? null,
        fileName: u.fileName ?? null,
        error: u.error ?? null,
        parsedAt: u.parsedAt?.toISOString() ?? null,
      }
    : null;

const summary = (b: BillDoc, now: Date) => ({
  period: b.period,
  start: b.start.toISOString(),
  end: b.end.toISOString(),
  inProgress: b.inProgress,
  days: daysOf(b, now),
  totalCents: b.totalCents,
  projectedCents: projectedCents(b, now),
  lines: b.lines,
  peakKw: b.peakKw,
  peakAt: b.peakAt?.toISOString() ?? null,
  savedCents: b.savedCents ?? null,
  estimatedShare: b.estimatedShare,
  utility: utilityView(b.utility),
});

export const listBills = async (site: SiteDoc, now = new Date()) => {
  const docs = await Bill.find({ siteId: site._id }).sort({ period: -1 }).lean<BillDoc[]>();
  const items = docs.map((b) => summary(b, now));
  const last12 = docs.filter((b) => !b.inProgress).slice(0, 12);
  const peak = last12.reduce<BillDoc | null>((m, b) => (!m || b.peakKw > m.peakKw ? b : m), null);
  const withSaving = last12.filter((b) => b.savedCents != null);
  const compared = docs.filter((b) => !b.inProgress && b.utility?.totalCents);
  return {
    items,
    kpis: {
      last12: last12.length ? { totalCents: last12.reduce((s, b) => s + b.totalCents, 0), from: last12.at(-1)!.period, to: last12[0].period } : null,
      saved12Cents: withSaving.length ? withSaving.reduce((s, b) => s + b.savedCents!, 0) : null,
      peak12: peak ? { kw: peak.peakKw, period: peak.period, demandCents: peak.lines!.demandCents } : null,
      // Mean |ours − utility| / utility, in percent (the App v2 "±0.6%").
      utilityDiffPct: compared.length
        ? Math.round((compared.reduce((s, b) => s + Math.abs(b.totalCents - b.utility!.totalCents!) / b.utility!.totalCents!, 0) / compared.length) * 1000) / 10
        : null,
      compared: compared.length,
    },
  };
};

const findBill = async (site: SiteDoc, period: string): Promise<BillDoc> => {
  const bill = await Bill.findOne({ siteId: site._id, period }).lean<BillDoc>();
  if (!bill) throw fail(404, `No bill for ${period}`);
  return bill;
};

/** Contiguous runs of estimated intervals, for "Estimated data: 17 Sep 02:10–04:40". */
const estimatedRuns = async (site: SiteDoc, bill: BillDoc) => {
  const rows = await Interval15.find({ siteId: site._id, start: { $gte: bill.start, $lt: bill.end }, quality: 'estimated' })
    .select('start')
    .sort({ start: 1 })
    .lean<{ start: Date }[]>();
  const runs: { start: string; end: string }[] = [];
  let run: { start: Date; end: Date } | null = null;
  for (const { start } of rows) {
    const end = new Date(start.getTime() + 15 * 60_000);
    if (run && run.end.getTime() === start.getTime()) run.end = end;
    else {
      if (run) runs.push({ start: run.start.toISOString(), end: run.end.toISOString() });
      run = { start, end };
    }
  }
  if (run) runs.push({ start: run.start.toISOString(), end: run.end.toISOString() });
  return runs;
};

export const billDetail = async (site: SiteDoc, period: string, now = new Date()) => {
  const bill = await findBill(site, period);
  const tariff = bill.tariffVersion != null ? await Tariff.findOne({ siteId: site._id, version: bill.tariffVersion }).lean<TariffDoc>() : null;
  const kwh = bill.energyKwh ?? { pk: 0, md: 0, op: 0, export: 0 };
  return {
    ...summary(bill, now),
    energyKwh: kwh,
    gridKwh: Math.round(((kwh.pk ?? 0) + (kwh.md ?? 0) + (kwh.op ?? 0)) * 1000) / 1000,
    tariff: tariff ? { version: tariff.version, name: tariff.name, demandRateCents: tariff.demandRateCents, fixedCents: tariff.fixedCents } : null,
    tariffVersions: bill.tariffVersions,
    intervals: bill.intervals,
    unpricedIntervals: bill.unpricedIntervals,
    estimated: await estimatedRuns(site, bill),
    savings: bill.savings ?? null,
    computedAt: bill.computedAt?.toISOString() ?? null,
  };
};

const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * Spending for any local date range, each day on the tariff version in force that day. Energy
 * only: demand is charged once per billing period, so the range shows its highest 15-minute
 * demand instead.
 */
export const rangeSpend = async (site: SiteDoc, from: string, to: string, now = new Date()) => {
  if (from > to) throw fail(400, '`from` must not be after `to`');
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  if (days > MAX_RANGE_DAYS) throw fail(400, `A range can be at most ${MAX_RANGE_DAYS} days`);
  const start = siteDateStart(from, site.tz);
  const end = siteDateStart(nextDate(to), site.tz);
  const [intervals, tariffs] = await Promise.all([
    Interval15.find({ siteId: site._id, start: { $gte: start, $lt: end } })
      .select('start grid export demandKw quality')
      .lean<IntervalLike[]>(),
    Tariff.find({ siteId: site._id }).lean<TariffDoc[]>(),
  ]);
  const b = computeBill({ period: `${from}..${to}`, start, end }, intervals, tariffs.map(tariffFromDoc), site.tz, now);
  const peak = intervals.reduce<IntervalLike | null>((m, iv) => (!m || iv.demandKw > m.demandKw ? iv : m), null);
  return {
    from,
    to,
    days,
    energyCents: energyOf(b),
    lines: { energyPkCents: b.lines.energyPkCents, energyMdCents: b.lines.energyMdCents, energyOpCents: b.lines.energyOpCents },
    exportCreditCents: b.lines.exportCreditCents,
    gridKwh: Math.round((b.energyKwh.pk + b.energyKwh.md + b.energyKwh.op) * 1000) / 1000,
    exportKwh: b.energyKwh.export,
    peak: peak ? { kw: Math.round(peak.demandKw * 100) / 100, at: peak.start.toISOString() } : null,
    tariffVersions: b.tariffVersions,
    intervals: b.intervals,
    estimatedShare: b.estimatedShare,
    unpricedIntervals: b.unpricedIntervals,
  };
};

/**
 * The statement PDF, rendered by the worker. A stored one is reused while nothing on the bill
 * has changed since it was rendered.
 */
export const statement = async (site: SiteDoc, period: string, jobs?: JobClient): Promise<{ filename: string; stream: Readable }> => {
  const bill = await findBill(site, period);
  const changedAt = Math.max(bill.computedAt?.getTime() ?? 0, bill.utility?.parsedAt?.getTime() ?? 0);
  let fileId = bill.statement?.fileId && bill.statement.renderedAt && bill.statement.renderedAt.getTime() >= changedAt ? bill.statement.fileId : null;
  if (fileId && !(await fileInfo(fileId))) fileId = null;
  if (!fileId) {
    if (!jobs) throw fail(503, 'Statements are unavailable right now');
    try {
      ({ fileId } = await jobs.run('statement', { siteId: String(site._id), period }, STATEMENT_TIMEOUT_MS));
    } catch (err) {
      if (err instanceof JobTimeout) throw fail(503, 'The statement is still being prepared. Try again in a minute.');
      throw err;
    }
  }
  return { filename: `statement-${period}.pdf`, stream: openFile(fileId!) };
};

const assertClosed = (bill: BillDoc) => {
  if (bill.inProgress) throw fail(409, 'The utility bill arrives after the period closes');
};

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

const kindOf = (file: UploadedFile): 'pdf' | 'csv' | null => {
  if (file.buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (/\.csv$/i.test(file.originalname) || /^text\/(csv|plain)$/.test(file.mimetype)) return 'csv';
  return null;
};

/** Stores an uploaded utility bill and asks the worker to read its total (202, processing). */
export const uploadUtilityBill = async (site: SiteDoc, userId: string, period: string, file: UploadedFile, jobs?: JobClient) => {
  const bill = await findBill(site, period);
  assertClosed(bill);
  const kind = kindOf(file);
  if (!kind) throw fail(415, 'Upload the bill as a PDF, or as a CSV with a total_due column');
  if (!jobs) throw fail(503, 'Uploads are unavailable right now');
  const contentType = kind === 'pdf' ? 'application/pdf' : 'text/csv';
  const fileId = await putFile(file.originalname || `utility-${period}.${kind}`, file.buffer, {
    siteId: String(site._id),
    kind: 'utility-bill',
    contentType,
    period,
    uploadedBy: userId,
  });
  const utility = { status: 'processing', fileId, fileName: file.originalname, uploadedBy: userId };
  await Bill.updateOne({ _id: bill._id }, { $set: { utility } });
  await recordAudit({ siteId: site._id, userId, action: 'bill.utility.upload', target: `bill:${period}`, before: bill.utility ?? null, after: { fileId, fileName: file.originalname } });
  await jobs.add('utility-bill', { siteId: String(site._id), period, fileId });
  return utilityView(utility as unknown as BillDoc['utility']);
};

/** The owner types the utility's total in (when extraction failed, or instead of uploading). */
export const enterUtilityTotal = async (site: SiteDoc, userId: string, period: string, totalCents: number, now = new Date()) => {
  const bill = await findBill(site, period);
  assertClosed(bill);
  const utility = { status: 'manual', totalCents, diffCents: bill.totalCents - totalCents, source: 'manual', uploadedBy: userId, parsedAt: now };
  await Bill.updateOne({ _id: bill._id }, { $set: { utility } });
  await recordAudit({ siteId: site._id, userId, action: 'bill.utility.enter', target: `bill:${period}`, before: bill.utility ?? null, after: { totalCents } });
  return utilityView(utility as unknown as BillDoc['utility']);
};
