import type { RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { SiteDoc } from '@ecomanage/db';
import type { SiteEvent } from '@ecomanage/shared';
import { handle, HttpError } from '../../lib/http';
import type { SiteEventHub } from '../../lib/siteEvents';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { buildSnapshot } from './snapshot';

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
    const unsubscribe = await hub.subscribe(String(site._id), (e) => (queued ? queued.push(e) : send(e.type, e)));
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs);
    // The response's 'close' is the documented signal that the client has gone away.
    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    try {
      if (!closed) send('snapshot', await buildSnapshot(site, redis));
    } catch {
      send('error', { message: 'Failed to load the site' });
    }
    const pending = queued;
    queued = null;
    for (const e of pending) send(e.type, e);
  };

  return { snapshot, stream };
};
