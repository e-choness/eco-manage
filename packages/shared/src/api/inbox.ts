import { z } from 'zod';

// The Inbox (plan P3-06, Backend Coverage: GET /api/inbox): decisions, alerts and active commands
// in one list, open or closed. Items keep their place: they are ordered by when they arrived, which
// never changes, and paged with a cursor, so an item moving from open to closed can't make others
// repeat or go missing between pages.

export const INBOX_TYPES = ['decide', 'alert', 'active'] as const;
export type InboxType = (typeof INBOX_TYPES)[number];

export interface InboxItem {
  key: string; // `${type}:${id}`, unique across the Inbox
  type: InboxType;
  id: string; // the recommendation, alert or command
  kind: 'Decision' | 'Alert' | 'Info' | 'Active' | 'Closed';
  title: string;
  deviceId: string | null;
  deviceName: string | null;
  sub: string; // one line under the title (App v2), e.g. "Battery · expected saving $266"
  status: string; // the recommendation, alert or command status
  at: string; // when it arrived: the order it is listed in
  due: string | null; // decide: when it expires; active: when it ends
}

export interface InboxCounts {
  open: Record<InboxType | 'all', number>;
  closed: Record<InboxType | 'all', number>;
}

export interface InboxPage {
  items: InboxItem[];
  counts: InboxCounts;
  nextCursor: string | null;
}

/** The `inbox` stream event: fresh counts and what changed. */
export interface InboxEvent {
  counts: InboxCounts;
  changed: { type: InboxType; id: string }[];
}

export const inboxQuery = z
  .object({
    state: z.enum(['open', 'closed']).default('open'),
    type: z.enum([...INBOX_TYPES, 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type InboxQuery = z.infer<typeof inboxQuery>;

/** Cursor: the last item's time and key (ASCII), base64url-encoded. */
export const encodeInboxCursor = (at: string, key: string): string => btoa(`${at}|${key}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeInboxCursor = (cursor: string): { at: string; key: string } | null => {
  try {
    const [at, key] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    return at && key && !Number.isNaN(Date.parse(at)) ? { at, key } : null;
  } catch {
    return null;
  }
};

/** Newest first; items that arrived at the same moment by key, so the order is total. */
export const inboxOrder = (a: Pick<InboxItem, 'at' | 'key'>, b: Pick<InboxItem, 'at' | 'key'>): number =>
  a.at === b.at ? (a.key < b.key ? 1 : a.key > b.key ? -1 : 0) : a.at < b.at ? 1 : -1;
