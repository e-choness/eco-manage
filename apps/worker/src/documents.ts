import PDFDocument from 'pdfkit';
import { extractText, getDocumentProxy } from 'unpdf';
import { Bill, Site, Tariff, fileInfo, putFile, readFileBuffer, type BillDoc, type SiteDoc, type TariffDoc } from '@ecomanage/db';
import type { DocumentJobs, StatementJob, UtilityBillJob } from '@ecomanage/shared';

// Documents (plan P2-05): statement PDFs rendered here rather than in the API, and utility bills
// read for their total so the bill page can compare it with ours.

// ---- statement -----------------------------------------------------------------------------------

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100).replace('−', '-');

const localDate = (at: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(at);
const localDateTime = (at: Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(at);

export interface StatementInput {
  site: Pick<SiteDoc, 'name' | 'tz' | 'currency'> & { address?: string | null };
  bill: BillDoc;
  tariff: Pick<TariffDoc, 'version' | 'name' | 'demandRateCents'> | null;
}

/** Statement lines in print order. Exported for the test, which reads them back from the PDF. */
export const statementLines = ({ site, bill, tariff }: StatementInput): [string, string][] => {
  const cur = site.currency || 'CAD';
  const l = bill.lines!;
  const kwh = bill.energyKwh ?? { pk: 0, md: 0, op: 0, export: 0 };
  const rate = tariff ? `$${(tariff.demandRateCents / 100).toFixed(2)}/kW` : 'no tariff';
  return [
    [`Energy - peak (${(kwh.pk ?? 0).toFixed(1)} kWh)`, money(l.energyPkCents, cur)],
    [`Energy - mid (${(kwh.md ?? 0).toFixed(1)} kWh)`, money(l.energyMdCents, cur)],
    [`Energy - off-peak (${(kwh.op ?? 0).toFixed(1)} kWh)`, money(l.energyOpCents, cur)],
    [`Demand - ${bill.peakKw.toFixed(1)} kW x ${rate}`, money(l.demandCents, cur)],
    ['Fixed fees', money(l.fixedCents, cur)],
    [`Export credit (${(kwh.export ?? 0).toFixed(1)} kWh)`, money(-l.exportCreditCents, cur)],
  ];
};

/** Renders the statement for one bill to PDF. */
export const renderStatement = (input: StatementInput, now = new Date()): Promise<Buffer> => {
  const { site, bill, tariff } = input;
  const cur = site.currency || 'CAD';
  const doc = new PDFDocument({ size: 'LETTER', margin: 56, info: { Title: `${site.name} statement ${bill.period}`, Author: 'EcoManage' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const row = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    const y = doc.y;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 11);
    doc.text(label, left, y, { width: width - 140 });
    doc.text(value, left + width - 140, y, { width: 140, align: 'right' });
    doc.moveDown(0.4);
  };

  doc.font('Helvetica-Bold').fontSize(18).text('Energy statement');
  doc.font('Helvetica').fontSize(11).fillColor('#555').text(site.name + (site.address ? `, ${site.address}` : ''));
  const lastDay = new Date(bill.end.getTime() - 1);
  doc.text(`Billing period ${localDate(bill.start, site.tz)} - ${localDate(lastDay, site.tz)}${bill.inProgress ? ' (in progress)' : ''}`);
  doc.fillColor('#000').moveDown(1.2);

  for (const [label, value] of statementLines(input)) row(label, value);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).stroke('#999');
  doc.moveDown(0.4);
  row(bill.inProgress ? 'Total so far' : 'Total', money(bill.totalCents, cur), { bold: true, size: 13 });
  doc.moveDown(1);

  const facts: [string, string][] = [
    ['Tariff', tariff ? `${tariff.name}, version ${tariff.version}` : 'None in force'],
    ['Tariff versions used', (bill.tariffVersions ?? []).join(', ') || '-'],
    ['Peak interval', bill.peakAt ? `${bill.peakKw.toFixed(1)} kW at ${localDateTime(bill.peakAt, site.tz)}` : '-'],
    ['Estimated data', `${Math.round((bill.estimatedShare ?? 0) * 1000) / 10}% of intervals`],
  ];
  if (bill.savedCents != null) facts.push(['Saved vs grid only', money(bill.savedCents, cur)]);
  if (bill.utility?.totalCents != null)
    facts.push(['Utility bill', `${money(bill.utility.totalCents, cur)} (difference ${money(bill.utility.diffCents ?? 0, cur)})`]);
  doc.fontSize(10);
  for (const [k, v] of facts) row(k, v, { size: 10 });

  doc.moveDown(2).fontSize(8).fillColor('#777');
  doc.text(
    `Our estimate from 15-minute meter data and the site's tariff, computed ${localDateTime(bill.computedAt ?? now, site.tz)}. ` +
      'The utility bill is authoritative. Demand is charged once per billing period.',
    left,
    doc.y,
    { width }
  );
  doc.end();
  return done;
};

export const statementJob = async ({ siteId, period }: StatementJob, now = new Date()): Promise<DocumentJobs['statement']['result']> => {
  const [site, bill] = await Promise.all([Site.findById(siteId).lean<SiteDoc>(), Bill.findOne({ siteId, period }).lean<BillDoc>()]);
  if (!site || !bill) throw new Error(`No bill ${period} for site ${siteId}`);
  const tariff = bill.tariffVersion != null ? await Tariff.findOne({ siteId, version: bill.tariffVersion }).lean<TariffDoc>() : null;
  const pdf = await renderStatement({ site, bill, tariff }, now);
  const fileId = await putFile(`statement-${period}.pdf`, pdf, { siteId, kind: 'statement', contentType: 'application/pdf', period });
  await Bill.updateOne({ _id: bill._id }, { $set: { statement: { fileId, renderedAt: now } } });
  return { fileId };
};

// ---- utility bill --------------------------------------------------------------------------------

const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, '')) * 100);
const AMOUNT = String.raw`\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})`;
// Most specific first: "Total amount due" beats a bare "Total" (which may be a subtotal).
const LABELS = [
  String.raw`total\s+amount\s+due`,
  String.raw`amount\s+due`,
  String.raw`total\s+due`,
  String.raw`balance\s+due`,
  String.raw`total\s+(?:current|new)\s+charges`,
  String.raw`new\s+charges`,
  String.raw`total`,
];

/** Finds the amount due in a utility bill's text, or null. */
export const totalFromText = (text: string): number | null => {
  const flat = text.replace(/\s+/g, ' ');
  for (const label of LABELS) {
    const m = new RegExp(String.raw`\b${label}\b[^\d$]{0,40}${AMOUNT}`, 'i').exec(flat);
    if (m) return toCents(m[1]);
  }
  return null;
};

/**
 * CSV template: a header row with `total_due` (or `total`, `amount_due`) and optionally
 * `period` (YYYY-MM). Takes the row for this period, or the only row.
 */
export const totalFromCsv = (csv: string, period: string): number | null => {
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')))
    .filter((r) => r.some((c) => c));
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => h.toLowerCase());
  const col = head.findIndex((h) => ['total_due', 'total', 'amount_due'].includes(h));
  if (col < 0) return null;
  const pcol = head.indexOf('period');
  const data = rows.slice(1);
  const row = pcol >= 0 ? data.find((r) => r[pcol] === period) : data.length === 1 ? data[0] : undefined;
  if (!row || !/\d/.test(row[col] ?? '')) return null;
  const cents = toCents(row[col]);
  return Number.isFinite(cents) ? cents : null;
};

export const pdfText = async (data: Buffer): Promise<string> => {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
};

export const utilityBillJob = async ({ siteId, period, fileId }: UtilityBillJob, now = new Date()): Promise<DocumentJobs['utility-bill']['result']> => {
  const [bill, info] = await Promise.all([Bill.findOne({ siteId, period }).lean<BillDoc>(), fileInfo(fileId)]);
  if (!bill || !info || info.metadata.siteId !== siteId) throw new Error(`No upload ${fileId} for ${period}`);
  // A newer upload or a typed-in total replaced this one: nothing to do.
  if (bill.utility?.fileId !== fileId) return { status: 'failed', totalCents: null };

  const data = await readFileBuffer(fileId);
  const isPdf = info.metadata.contentType === 'application/pdf' || data.subarray(0, 5).toString() === '%PDF-';
  let totalCents: number | null = null;
  try {
    totalCents = isPdf ? totalFromText(await pdfText(data)) : totalFromCsv(data.toString('utf8'), period);
  } catch {
    totalCents = null;
  }
  const filter = { _id: bill._id, 'utility.fileId': fileId };
  if (totalCents == null) {
    await Bill.updateOne(filter, {
      $set: { 'utility.status': 'failed', 'utility.error': "Couldn't find the amount due. Type the total in instead.", 'utility.parsedAt': now },
    });
    return { status: 'failed', totalCents: null };
  }
  await Bill.updateOne(filter, {
    $set: {
      'utility.status': 'done',
      'utility.totalCents': totalCents,
      'utility.diffCents': bill.totalCents - totalCents,
      'utility.source': isPdf ? 'pdf' : 'csv',
      'utility.parsedAt': now,
    },
    $unset: { 'utility.error': 1 },
  });
  return { status: 'done', totalCents };
};
