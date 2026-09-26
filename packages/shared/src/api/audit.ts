import { z } from 'zod';

// The audit log (plan §0.8 and P3-07, Backend Coverage: GET /api/audit, owner). Every write to a
// site records who did what to which thing, with the values before and after.

export interface AuditEntry {
  id: string;
  ts: string;
  action: string; // e.g. "device.update", "recommendation.approve"
  target: string; // e.g. "device:6500…0101"
  user: { id: string; name: string } | null; // null: done by the system (rules, worker, gateway)
  before: unknown;
  after: unknown;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a date');

export const auditQuery = z
  .object({
    // "device.update", or a group such as "device" for every device action
    action: z.string().regex(/^[a-z][a-z0-9.-]*$/).max(64).optional(),
    userId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
    target: z.string().min(1).max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuery>;
