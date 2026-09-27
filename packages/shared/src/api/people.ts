import { z } from 'zod';
import { ROLES, type Role } from '../models';
import type { InviteView } from './invites';

// Settings → People (Backend Coverage: GET/PATCH/DELETE /api/site/members, P4-08). Owner only.
// "Access until" is a local date: access lasts to the end of that day in the site's time zone.

export interface MemberView {
  id: string; // the membership
  userId: string;
  name: string;
  email: string;
  role: Role;
  until: string | null; // local YYYY-MM-DD, last day with access
  you: boolean;
}

export interface PeopleResponse {
  members: MemberView[];
  invites: InviteView[]; // not accepted yet
}

export const memberPatch = z
  .object({
    role: z.enum(ROLES),
    until: z.string().date().nullable(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type MemberPatch = z.infer<typeof memberPatch>;
