import type { RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { SiteDoc } from '@ecomanage/db';
import type { InboxEvent, InboxType, SiteEvent } from '@ecomanage/shared';
import { handle, HttpError } from '../../lib/http';
import type { SiteEventHub } from '../../lib/siteEvents';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { buildSnapshot } from './snapshot';
import { inboxCounts } from '../inbox/service';

const INBOX_DEBOUNCE_MS = 300;

export interface SiteControllerDeps {
  redis?: Redis;
  hub?: SiteEventHub;
  heartbeatMs?: number;
}

const siteOf = (req: AuthenticatedRequest): SiteDoc => {
  if (!req.site) throw new HttpError(403, { error: { code: 403, message: 'No access to this site' } });
  return req.site;
};

const unavailable = () => new HttpError(503, { error: { code: 503, message: 'Live data is unavailable (no Redis)' } });

export const siteController = ({ redis, hub, heartbeatMs = 20_000 }: SiteControllerDeps) => {
  const snapshot = handle({ status: 500, body: { error: { code: 500, message: 'Failed to load the site' } } }, async (req, res) => {
    if (!redis) throw unavailable();
    res.json(await buildSnapshot(siteOf(req), redis));
  });

  // Server-sent events: `snapshot` first, then telemetry/demand/... as ingest publishes them,
  // and a comment line every 20 s to keep proxies from closing the connection.
  const stream: RequestHandler = async (req: AuthenticatedRequest, res: Response) => {
    if (!redis || !hub) {
      res.status(503).json(unavailable().body);
      return;
    }
    const site = siteOf(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let closed = false;
    // Subscribe before building the snapshot so nothing is missed, but hold events back until the
    // snapshot has gone out: clients apply events on top of it.
    let queued: SiteEvent[] | null = [];
    // Inbox changes (a decision, alert or command) become one `inbox` event with fresh counts,
    // at most every INBOX_DEBOUNCE_MS; alert and command events also go out as themselves.
    let changed: InboxEvent['changed'] = [];
    let inboxTimer: NodeJS.Timeout | null = null;
    const sendInbox = async () => {
      if (inboxTimer) clearTimeout(inboxTimer);
      inboxTimer = null;
      const batch = changed;
      changed = [];
      try {
        if (!closed) send('inbox', { counts: await inboxCounts(site), changed: batch } satisfies InboxEvent);
      } catch {
        // counts come again with the next change
      }
    };
    const noteInbox = (type: InboxType, id: string) => {
      if (!changed.some((c) => c.type === type && c.id === id)) changed.push({ type, id });
      inboxTimer ??= setTimeout(() => void sendInbox(), INBOX_DEBOUNCE_MS);
    };
    const deliver = (e: SiteEvent) => {
      if (e.type === 'inbox') return noteInbox(e.itemType, e.itemId);
      if (e.type === 'alert') noteInbox('alert', e.alert.id);
      if (e.type === 'command') noteInbox('active', e.commandId);
      send(e.type, e);
    };
    const unsubscribe = await hub.subscribe(String(site._id), (e) => (queued ? queued.push(e) : deliver(e)));
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs);
    // The response's 'close' is the documented signal that the client has gone away.
    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      if (inboxTimer) clearTimeout(inboxTimer);
      unsubscribe();
    });
    try {
      if (!closed) send('snapshot', await buildSnapshot(site, redis));
    } catch {
      send('error', { message: 'Failed to load the site' });
    }
    const pending = queued;
    queued = null;
    for (const e of pending) deliver(e);
    // The Inbox badge needs its counts from the start.
    if (!closed) await sendInbox();
  };

  return { snapshot, stream };
};
