import { z } from 'zod';

// History → Export CSV and Reports (Backend Coverage: POST /api/exports, /api/reports; P4-05).
// Exports are made by the worker from the 15-minute intervals; big ones are also emailed as a
// link. Reports are saved here and rendered by the reports worker (P5-01).

const localDate = z.string().date();

export const exportCreate = z
  .object({ from: localDate, to: localDate })
  .strict()
  .refine((b) => b.from <= b.to, { message: 'The range must end after it starts', path: ['to'] });
export type ExportCreate = z.infer<typeof exportCreate>;

export interface ExportView {
  id: string;
  from: string;
  to: string;
  status: 'queued' | 'done' | 'failed';
  rows: number | null;
  error: string | null;
  large: boolean; // also emailed as a link when ready
  createdAt: string;
}

/** Report sections (App v2 report builder). Installers can't pick the cost section. */
export const REPORT_SECTIONS = ['summary', 'sources', 'demand', 'cost', 'devices', 'decisions', 'alerts'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const REPORT_SECTION_LABEL: Record<ReportSection, string> = {
  summary: 'Energy summary',
  sources: 'Sources and consumers',
  demand: 'Demand peaks',
  cost: 'Energy cost',
  devices: 'Device availability',
  decisions: 'Decisions and commands',
  alerts: 'Alerts',
};

export const REPORT_FORMATS = ['pdf', 'csv', 'xlsx'] as const;
export const REPORT_SCHEDULES = ['once', 'weekly', 'monthly'] as const;
export const REPORT_SCHEDULE_LABEL: Record<(typeof REPORT_SCHEDULES)[number], string> = { once: 'One-off', weekly: 'Weekly, Monday', monthly: 'Monthly, 1st' };

export const reportCreate = z
  .object({
    name: z.string().trim().min(1).max(120),
    from: localDate,
    to: localDate,
    sections: z.array(z.enum(REPORT_SECTIONS)).min(1, 'Pick at least one section').max(REPORT_SECTIONS.length),
    format: z.enum(REPORT_FORMATS),
    schedule: z.enum(REPORT_SCHEDULES),
    recipients: z.array(z.string().trim().toLowerCase().email()).max(20).default([]),
    notes: z.string().trim().max(1000).default(''),
  })
  .strict()
  .refine((b) => b.from <= b.to, { message: 'The range must end after it starts', path: ['to'] })
  .refine((b) => b.schedule === 'once' || b.recipients.length > 0, { message: 'A scheduled report needs at least one recipient', path: ['recipients'] });
export type ReportCreate = z.infer<typeof reportCreate>;

export interface ReportView {
  id: string;
  name: string;
  from: string;
  to: string;
  sections: ReportSection[];
  format: (typeof REPORT_FORMATS)[number];
  schedule: (typeof REPORT_SCHEDULES)[number];
  recipients: string[];
  notes: string;
  status: 'waiting' | 'ready' | 'failed'; // waiting: not rendered yet
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  canDelete: boolean; // the creator or the owner
}
