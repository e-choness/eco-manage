// BullMQ queues shared by the API (producer) and the worker (consumer).

export const QUEUES = {
  /** Repeating: interval costs, nightly bills. */
  billing: 'billing',
  /** On demand: statement PDFs, utility bill extraction. */
  documents: 'documents',
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
