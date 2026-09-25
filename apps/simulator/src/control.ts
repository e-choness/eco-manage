import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Gateway } from './gateway';
import { faultInput } from './gateway';
import type { SimClock } from './clock';
import type { SiteEngine } from './engine/site';

// Development control API (plan: /sim/faults, /sim/clock). Only reachable inside the compose
// network and on localhost; the API proxies it for admins in a later task.

const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const createControlServer = (engine: SiteEngine, gateway: Gateway, clock: SimClock): Server =>
  createServer(async (req, res) => {
    try {
      const url = req.url?.split('?')[0];
      if (req.method === 'GET' && url === '/sim/state') {
        return send(res, 200, {
          now: engine.now.toISOString(),
          speed: clock.speed,
          seed: engine.seed,
          dayType: engine.dayType(),
          weather: engine.weather(),
          battery: engine.batteryState(),
          faults: gateway.activeFaults(),
          buffered: gateway.bufferedCount(),
        });
      }
      if (req.method === 'POST' && url === '/sim/faults') {
        const parsed = faultInput.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: { code: 400, message: 'Invalid fault', details: parsed.error.issues } });
        if (parsed.data.device && !engine.devices.has(parsed.data.device)) {
          return send(res, 400, { error: { code: 400, message: `Unknown device ${parsed.data.device}` } });
        }
        return send(res, 201, gateway.addFault(parsed.data));
      }
      if (req.method === 'DELETE' && url === '/sim/faults') {
        gateway.clearFaults();
        return send(res, 200, { faults: [] });
      }
      if (req.method === 'POST' && url === '/sim/clock') {
        const parsed = z.object({ speed: z.number() }).safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: { code: 400, message: 'speed is required' } });
        try {
          clock.setSpeed(parsed.data.speed);
        } catch (err) {
          return send(res, 400, { error: { code: 400, message: (err as Error).message } });
        }
        return send(res, 200, { speed: clock.speed, now: clock.now().toISOString() });
      }
      return send(res, 404, { error: { code: 404, message: 'Not found' } });
    } catch {
      return send(res, 400, { error: { code: 400, message: 'Invalid JSON' } });
    }
  });
