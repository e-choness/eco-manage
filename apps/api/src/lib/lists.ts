import { z } from 'zod';
import User from '../modules/auth/model';

// Shared by the Inbox's lists (alerts, recommendations): the open / closed page query, and the
// name shown for whoever acted on an item.

export const openClosedQuery = z
  .object({
    state: z.enum(['open', 'closed']).default('open'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    before: z.coerce.date().optional(),
  })
  .strict();

/** `{ id, name }` for a user id (their email when they have no name), or null. */
export const personRef = async (id: unknown): Promise<{ id: string; name: string } | null> => {
  if (!id) return null;
  const u = await User.findById(id).select('name email').lean();
  return u ? { id: String(u._id), name: u.name || u.email } : null;
};
