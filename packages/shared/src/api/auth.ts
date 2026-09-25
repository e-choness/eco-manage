import { z } from 'zod';
import { ROLES } from '../models';

export const membershipSummary = z.object({
  siteId: z.string(),
  siteName: z.string(),
  role: z.enum(ROLES),
  until: z.string().nullable(),
});

/** GET /api/auth/me: the user plus the memberships that decide what they can see and do. */
export const meResponse = z.object({
  _id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  memberships: z.array(membershipSummary),
});
export type MeResponse = z.infer<typeof meResponse>;
