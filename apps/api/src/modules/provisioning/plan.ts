import { z } from 'zod';
import { ROLES, siteFields } from '@ecomanage/shared';

// A provisioning plan: the sites and who has access to each, as a directory or CRM would export
// them. Applying it makes the database match (see service.ts); applying it again changes nothing.
//
// {
//   "sites": [{
//     "externalId": "crm-4711",            the site's id where the plan comes from (optional)
//     "name": "Maple Grove School",
//     "tz": "America/Toronto",              and any other site detail Settings has
//     "members": [
//       { "email": "owner@example.com", "role": "owner" },
//       { "email": "sam@solar.example", "role": "installer", "until": "2026-12-31" }
//     ]
//   }]
// }

const member = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(ROLES),
    // The last local day with access; none for lasting access.
    until: z.string().date().nullable().optional(),
  })
  .strict();

const site = z
  .object({
    externalId: z.string().trim().min(1).max(200).optional(),
    ...siteFields,
    members: z.array(member).max(1000).default([]),
  })
  .partial({ address: true, tz: true, lat: true, lon: true, currency: true, billDay: true, demandCapKw: true })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.members.forEach((m, i) => {
      if (seen.has(m.email)) ctx.addIssue({ code: 'custom', path: ['members', i, 'email'], message: `${m.email} is listed twice` });
      seen.add(m.email);
    });
  });

export const provisionPlan = z
  .object({ sites: z.array(site).min(1).max(1000) })
  .strict()
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    p.sites.forEach((s, i) => {
      // Without an external id a site is found by its name, so the name must be unique.
      const [key, seen, what] = s.externalId ? [s.externalId, ids, 'externalId'] : [s.name, names, 'name'];
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['sites', i, what], message: `${key} is listed twice` });
      seen.add(key);
    });
  });

export type ProvisionPlan = z.infer<typeof provisionPlan>;
export type PlanSite = ProvisionPlan['sites'][number];
export type PlanMember = PlanSite['members'][number];

/** Readable reasons for a plan that doesn't parse: "sites.0.members.1.role: …". */
export const planIssues = (err: z.ZodError): string[] => err.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`);
