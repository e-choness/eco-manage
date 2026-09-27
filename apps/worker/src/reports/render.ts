import ExcelJS from 'exceljs';
import type { Block, Cell, ReportDocument } from './content';

// One report, three formats (P5-01): HTML that Gotenberg prints to PDF, CSV with a block per
// section, and XLSX with a sheet per section.

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmt = (c: Cell, digits: number | null | undefined) =>
  c == null ? '' : typeof c === 'number' ? c.toLocaleString('en-US', { minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? 3 }) : c;

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('Sept', 'Sep');
export const rangeText = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
const generated = (doc: ReportDocument) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: doc.tz }).format(doc.generatedAt).replace('Sept', 'Sep');

// ---- HTML (for PDF) -----------------------------------------------------------------------------

const blockHtml = (b: Block): string => {
  if (b.kind === 'note') return `<p class="note">${escape(b.text)}</p>`;
  if (b.kind === 'figures')
    return `<dl class="figures">${b.items.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl>`;
  const numeric = b.head.map((_, i) => b.rows.some((r) => typeof r[i] === 'number'));
  const cls = (i: number) => (numeric[i] ? ' class="num"' : '');
  const body = b.rows.length
    ? b.rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${escape(fmt(c, b.digits?.[i]))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${b.head.length}" class="empty">None in this period.</td></tr>`;
  return `<h3>${escape(b.title)}</h3><table><thead><tr>${b.head.map((h, i) => `<th${cls(i)}>${escape(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
};

export const reportHtml = (doc: ReportDocument): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(doc.title)}</title>
<style>
  @page { size: Letter; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; color: #172031; margin: 0; }
  header { border-bottom: 2px solid #3ecf8e; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  .meta { color: #566174; margin: 0; }
  .notes { background: #f2f4f7; border-radius: 6px; padding: 8px 12px; margin: 12px 0 0; white-space: pre-wrap; }
  h2 { font-size: 13pt; margin: 22px 0 8px; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 12px 0 6px; color: #566174; break-after: avoid; }
  section { break-inside: auto; }
  .figures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 0; }
  .figures div { border: 1px solid #e3e7ed; border-radius: 6px; padding: 6px 10px; break-inside: avoid; }
  dt { color: #566174; font-size: 9pt; }
  dd { margin: 2px 0 0; font-size: 12pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e3e7ed; vertical-align: top; }
  th { color: #566174; font-weight: 500; font-size: 9pt; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty, .note { color: #566174; }
  footer { margin-top: 24px; color: #566174; font-size: 8.5pt; }
</style>
</head>
<body>
<header>
  <h1>${escape(doc.title)}</h1>
  <p class="meta">${escape(doc.siteName)}${doc.address ? ` · ${escape(doc.address)}` : ''}</p>
  <p class="meta">${escape(rangeText(doc.from, doc.to))} · times in ${escape(doc.tz)}</p>
  ${doc.notes ? `<p class="notes">${escape(doc.notes)}</p>` : ''}
</header>
${doc.sections.map((s) => `<section><h2>${escape(s.title)}</h2>${s.blocks.map(blockHtml).join('\n')}</section>`).join('\n')}
<footer>Made by EcoManage on ${escape(generated(doc))} from 15-minute readings.</footer>
</body>
</html>
`;

// ---- CSV -----------------------------------------------------------------------------------------

const csvCell = (c: Cell) => {
  const s = c == null ? '' : String(c);
  // Quote when needed; a leading =, +, - or @ would be read as a formula by spreadsheets.
  const safe = /^[=+\-@]/.test(s) && typeof c !== 'number' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvLine = (cells: Cell[]) => cells.map(csvCell).join(',');

export const reportCsv = (doc: ReportDocument): string => {
  const lines = [csvLine([doc.title]), csvLine([doc.siteName, doc.from, doc.to, doc.tz])];
  if (doc.notes) lines.push(csvLine([doc.notes]));
  for (const s of doc.sections) {
    lines.push('', csvLine([`# ${s.title}`]));
    for (const b of s.blocks) {
      if (b.kind === 'note') lines.push(csvLine([b.text]));
      else if (b.kind === 'figures') for (const [k, v] of b.items) lines.push(csvLine([k, v]));
      else {
        lines.push(csvLine([b.title]), csvLine(b.head));
        for (const r of b.rows) lines.push(csvLine(r));
      }
    }
  }
  return `${lines.join('\n')}\n`;
};

// ---- XLSX ----------------------------------------------------------------------------------------

export const reportXlsx = async (doc: ReportDocument): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EcoManage';
  wb.created = doc.generatedAt;
  const cover = wb.addWorksheet('Report');
  cover.addRows([[doc.title], [doc.siteName], ['Period', doc.from, doc.to], ['Time zone', doc.tz], ...(doc.notes ? [['Notes', doc.notes]] : [])]);
  cover.getCell('A1').font = { bold: true, size: 14 };
  cover.getColumn(1).width = 24;
  const used = new Set<string>(['Report']);
  for (const s of doc.sections) {
    // Sheet names: at most 31 characters and unique.
    let name = s.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    for (let i = 2; used.has(name); i++) name = `${s.title.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.addRow([s.title]).font = { bold: true, size: 12 };
    for (const b of s.blocks) {
      ws.addRow([]);
      if (b.kind === 'note') ws.addRow([b.text]);
      else if (b.kind === 'figures') for (const [k, v] of b.items) ws.addRow([k, v]);
      else {
        ws.addRow([b.title]).font = { bold: true };
        ws.addRow(b.head).font = { bold: true, color: { argb: 'FF566174' } };
        for (const r of b.rows) {
          const row = ws.addRow(r.map((c) => (c == null ? '' : c)));
          b.digits?.forEach((d, i) => {
            if (d != null) row.getCell(i + 1).numFmt = d === 0 ? '#,##0' : `#,##0.${'0'.repeat(d)}`;
          });
        }
      }
    }
    ws.columns.forEach((c, i) => (c.width = i === 0 ? 26 : 16));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};
