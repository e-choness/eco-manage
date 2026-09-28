import { createHash, randomBytes } from 'node:crypto';
import { Membership, Report, Site, putFile, type ReportDoc, type SiteDoc } from '@ecomanage/db';
import { reportRunRange, type ReportJob, type ReportSection } from '@ecomanage/shared';
import type { Mailer } from '../email/mailer';
import { sendOnce } from '../email/notify';
import { reportEmail } from '../email/templates';
import { reportContent } from './content';
import type { HtmlToPdf } from './pdf';
import { reportCsv, reportHtml, reportXlsx } from './render';

// Renders one run of a report (P5-01): the report's own dates for a one-off, the previous week or
// month for a scheduled run. The file goes to the file store, and each recipient is emailed a
// link that works without signing in for LINK_DAYS (only the token's hash is stored).

const LINK_DAYS = 30;
const KEEP_FILES = 24;
const CONTENT_TYPE = { pdf: 'application/pdf', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

export interface ReportDeps {
  pdf: HtmlToPdf;
  mailer: Mailer;
  appUrl: string;
  now?: Date;
}

export type ReportRunResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ready'; fileId: string; from: string; to: string; emailed: number }
  | { status: 'failed'; error: string };

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'report';

const fail = async (r: ReportDoc, error: string): Promise<ReportRunResult> => {
  await Report.updateOne({ _id: r._id }, { $set: { status: 'failed', error } });
  return { status: 'failed', error };
};

export const renderReportJob = async ({ reportId, scheduled }: ReportJob, deps: ReportDeps): Promise<ReportRunResult> => {
  const now = deps.now ?? new Date();
  const r = await Report.findById(reportId).lean<ReportDoc>();
  if (!r) return { status: 'skipped', reason: 'report removed' };
  if (scheduled && r.schedule === 'once') return { status: 'skipped', reason: 'not a scheduled report' };
  if (!scheduled && r.schedule !== 'once') return { status: 'skipped', reason: 'scheduled reports run on their schedule' };

  const site = await Site.findById(r.siteId).lean<SiteDoc>();
  if (!site) return fail(r, 'The site no longer exists');
  // A report runs with its creator's access: none once they have left the site, and no money
  // unless they see it.
  const member = await Membership.findOne({ siteId: r.siteId, userId: r.createdBy, $or: [{ until: null }, { until: { $gt: now } }] }).lean();
  if (!member) return fail(r, 'The person who made this report no longer has access to the site');
  const money = member.role === 'owner' || member.role === 'manager';

  const range = r.schedule === 'once' ? { from: r.from, to: r.to } : reportRunRange(r.schedule as 'weekly' | 'monthly', now, site.tz);
  try {
    const doc = await reportContent({ site, name: r.name, from: range.from, to: range.to, sections: r.sections as ReportSection[], notes: r.notes, money, now });
    const format = r.format as keyof typeof CONTENT_TYPE;
    const data = format === 'pdf' ? await deps.pdf(reportHtml(doc)) : format === 'xlsx' ? await reportXlsx(doc) : Buffer.from(reportCsv(doc));
    const fileId = await putFile(`${slug(r.name)}-${range.from}-to-${range.to}.${format}`, data, {
      siteId: String(r.siteId),
      kind: 'report',
      contentType: CONTENT_TYPE[format],
      reportId: String(r._id),
    });
    const token = randomBytes(32).toString('base64url');
    const linkExpiresAt = new Date(now.getTime() + LINK_DAYS * 86_400_000);
    await Report.updateOne(
      { _id: r._id },
      {
        $set: { status: 'ready', fileId, lastRunAt: now, error: null },
        $push: { files: { $each: [{ runAt: now, ...range, status: 'ready', fileId, tokenHash: hashToken(token), linkExpiresAt }], $slice: -KEEP_FILES } },
      }
    );

    let emailed = 0;
    const link = `${deps.appUrl.replace(/\/$/, '')}/api/report-links/${token}`;
    for (const to of r.recipients) {
      // One email per recipient and period, even if the job is retried.
      const claim = { key: `report:${r._id}:${range.from}:${range.to}:${to}`, siteId: String(r.siteId), userId: null, kind: 'report' as const };
      if (await sendOnce(deps.mailer, claim, reportEmail(site, { name: r.name, format }, range, to, link, linkExpiresAt), now)) emailed++;
    }
    return { status: 'ready', fileId, ...range, emailed };
  } catch (err) {
    await fail(r, (err as Error).message);
    throw err;
  }
};
