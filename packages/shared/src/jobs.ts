// BullMQ queues shared by the API (producer) and the worker (consumer).

export const QUEUES = {
  /** Repeating: interval costs, nightly bills. */
  billing: 'billing',
  /** On demand: statement PDFs, utility bill extraction. */
  documents: 'documents',
  /** Repeating: alert emails, escalation, daily summaries (P2-09). On demand: invites (P4-02). */
  email: 'email',
  /** Hourly PV and load forecasts, and on demand after calendar or array changes (P2-10). */
  forecast: 'forecast',
  /** Report files (P5-01): one-off reports on demand, weekly and monthly ones from per-report schedulers. */
  reports: 'reports',
} as const;

export interface StatementJob {
  siteId: string;
  period: string;
}

export interface UtilityBillJob {
  siteId: string;
  period: string;
  fileId: string;
}

export interface DocumentJobs {
  statement: { data: StatementJob; result: { fileId: string } };
  'utility-bill': { data: UtilityBillJob; result: { status: 'done' | 'failed'; totalCents: number | null } };
  'export-csv': { data: ExportJob; result: { rows: number } };
}

/** `invite` on the email queue: the link's token travels only in the job, never stored. */
export interface InviteJob {
  inviteId: string;
  token: string;
}

/** `export-csv` on the documents queue (P4-05): every 15-min interval of a range as CSV. */
export interface ExportJob {
  exportId: string;
}

/**
 * `report` on the reports queue (P5-01). `scheduled` runs come from the report's job scheduler and
 * cover the previous week or month; the others render the report's own dates.
 */
export interface ReportJob {
  reportId: string;
  scheduled?: boolean;
}

/** Options for report jobs, the same from the API and the worker's sweep. */
export const REPORT_JOB_OPTS = { attempts: 2, backoff: { type: 'fixed', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 };

/** Job id of a one-off report's render, so the API and the sweep never queue it twice. */
export const reportOnceJobId = (reportId: string): string => `report-once-${reportId}`;
