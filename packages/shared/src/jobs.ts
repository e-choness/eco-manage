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
