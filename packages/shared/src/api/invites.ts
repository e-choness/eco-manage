import { z } from 'zod';
import { ROLES } from '../models';

// Invites (Backend Coverage: POST /api/site/invites, POST /api/invites/:token/accept). EcoManage is
// invite-only: an owner invites an email address with a role; the email carries a single-use
// link, and accepting it creates the account (or signs in an existing one) and the membership.

export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 8;

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a date');

export const inviteCreate = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(ROLES),
    until: isoDate.nullable().optional(), // access ends then (recommended for installers)
  })
  .strict();
export type InviteCreate = z.infer<typeof inviteCreate>;

/** New account: name and password. Existing account: its password. */
export const inviteAccept = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(1).max(200),
  })
  .strict();
export type InviteAccept = z.infer<typeof inviteAccept>;

export interface InviteView {
  id: string;
  email: string;
  role: (typeof ROLES)[number];
  until: string | null;
  expiresAt: string;
  invitedBy: string | null;
}

/** What the invite page shows before accepting (GET /api/invites/:token). */
export interface InvitePreview {
  siteName: string;
  email: string;
  role: (typeof ROLES)[number];
  until: string | null;
  expiresAt: string;
  invitedBy: string | null;
  hasAccount: boolean; // sign in with the existing password instead of creating one
}
