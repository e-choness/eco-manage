import { z } from 'zod';

// Error body for every v2 endpoint (plan §3.2).
export const ERROR_CODES = [400, 401, 403, 404, 409, 422, 429, 500] as const;
export const apiError = z.object({
  error: z.object({
    code: z.number().int().min(400).max(599),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

/** `?cursor&limit` for list endpoints (default 50). */
export const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuery>;

export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const RESOLUTIONS = ['15m', 'h', 'd', 'w', 'mo'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** History queries: dates are ISO dates in site time; the server caps a response at 400 points. */
export const historyQuery = z.object({
  from: z.string().date(),
  to: z.string().date(),
  res: z.enum(RESOLUTIONS),
});
export type HistoryQuery = z.infer<typeof historyQuery>;

export const MAX_POINTS = 400;
