// BullMQ queues shared by the API (producer) and the worker (consumer).

export const QUEUES = {
  /** Repeating: interval costs, nightly bills. */
  billing: 'billing',
  /** On demand: statement PDFs, utility bill extraction. */
  documents: 'documents',
  /** Repeating: alert emails, escalation, daily summaries (P2-09). */
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
}
