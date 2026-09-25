/**
 * P1-08: GET /api/site/snapshot and the SSE stream, against real MongoDB and Redis.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Redis } from 'ioredis';
import { Device, Interval15, Membership, Site, Telemetry } from '@ecomanage/db';
import { DEMO_DEVICES, DEMO_SITE, siteEventsChannel, type SiteSnapshot } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import { SiteEventHub } from '../../lib/siteEvents';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/4') || 'redis://redis:6379/4';
// Own site and device ids: Redis pub/sub channels are shared across databases, so the demo site's
// channel would also carry live events from a running dev stack.
const SITE_ID = '650000000000000000000042';
const DEVICES = DEMO_DEVICES.map((d, i) => ({ ...d, id: `6500000000000000000042${String(i + 1).padStart(2, '0')}` }));
const dev = (key: string) => DEVICES.find((d) => d.key === key)!;
const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 };

let redis: Redis;
let hub: SiteEventHub;
let token: string;
let app: ReturnType<typeof createApp>;

const iso = (ms: number) => new Date(ms).toISOString();

beforeAll(async () => {
  await connectTestDb('site');
  redis = new Redis(REDIS);
  await redis.flushdb();
  hub = new SiteEventHub(redis);
  process.env.JWT_SECRET = 'site-jwt';
  app = createApp({ env, redis, hub, sseHeartbeatMs: 200 });

  await Site.create({ _id: SITE_ID, ...DEMO_SITE });
  await Device.insertMany(
    DEVICES.map((d) => ({ _id: d.id, siteId: SITE_ID, type: d.type, name: d.name, profileId: d.profileId, status: 'live', ratedKw: d.ratedKw }))
  );
  const user = await User.create({ email: 'mgr@example.com', password: await generatePasswordHash('pw123456') });
  await Membership.create({ userId: user._id, siteId: SITE_ID, role: 'installer' });
  token = jwt.sign({ sub: String(user._id) }, 'site-jwt');
});

afterAll(async () => {
  await hub.close();
  await redis.flushdb();
  await redis.quit();
  await disconnectTestDb();
});

describe('GET /api/site/snapshot', () => {
  it('returns devices with latest readings, live flows, battery, demand, month peak and gateway', async () => {
    const now = Date.now();
    // The server takes the interval from the meter reading's time (now - 2 s)
    const intervalStart = Math.floor((now - 2000) / 900_000) * 900_000;
    const latest = (key: string, reading: object) => redis.set(`latest:${dev(key).id}`, JSON.stringify({ ts: iso(now - 2000), q: 'ok', ...reading }));
    await latest('invA', { p_kw: 36.1, e_out_kwh: 1000 });
    await latest('invB', { p_kw: 25.3, e_out_kwh: 900 });
    await latest('bat', { p_kw: 20, soc_pct: 68.2, reserve_pct: 20, usable_kwh: 200, soh_pct: 97 });
    await latest('ev1', { p_kw: -7.4, e_in_kwh: 10 });
    await latest('hp', { p_kw: -18, e_in_kwh: 10 });
    // Meter: 12 kWh imported since the interval start (counter read 10 s before the boundary at 90 kW)
    const elapsedH = (now - 2000 - intervalStart) / 3_600_000;
    await latest('meter', { p_kw: 90, e_in_kwh: 50_000.25 + 90 * elapsedH, e_out_kwh: 5 });
    await Telemetry.create({ ts: new Date(intervalStart - 10_000), meta: { siteId: SITE_ID, deviceId: dev('meter').id }, p_kw: 90, e_in_kwh: 50_000 });
    await Interval15.create([
      { siteId: SITE_ID, start: new Date(intervalStart - 3_600_000), demandKw: 112 },
      { siteId: SITE_ID, start: new Date(intervalStart - 1_800_000), demandKw: 88 },
    ]);
    await redis.set(`gw:${SITE_ID}`, JSON.stringify({ ts: iso(now), fw: '1.4.2', uptimeS: 5, buffered: 0, oldestBufferedTs: null, clockOffsetMs: 0, receivedAt: iso(now - 5000) }));

    const res = await request(app).get('/api/site/snapshot').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const s = res.body as SiteSnapshot;
    expect(s.site).toMatchObject({ id: SITE_ID, name: 'Maple Grove School', tz: 'America/Toronto', demandCapKw: 120 });
    expect(s.devices).toHaveLength(DEVICES.length);
    expect(s.devices.find((d) => d.id === dev('invA').id)?.latest?.p_kw).toBe(36.1);
    expect(s.flows).toMatchObject({ pv: 61.4, battery: 20, grid: 90, ev: -7.4, heatpump: -18, stale: expect.arrayContaining([dev('ev2').id]) });
    expect(s.flows.building).toBeCloseTo(61.4 + 20 + 90 - 7.4 - 18);
    expect(s.battery).toMatchObject({ socPct: 68.2, minutesLeft: 281 });
    expect(s.demand?.quality).toBe('ok');
    expect(s.demand?.intervalStart).toBe(iso(intervalStart));
    expect(s.demand?.soFarKw).toBeCloseTo(90, 0);
    if (elapsedH * 3600 >= 30) expect(s.demand?.projectedKw).toBeCloseTo(90, 0);
    expect(s.monthPeak?.kw).toBe(112);
    expect(s.gateway).toMatchObject({ online: true, fw: '1.4.2', buffered: 0 });
  });

  it('marks demand estimated when there is no meter reading near the interval start', async () => {
    await Telemetry.deleteMany({});
    // 10 minutes into an interval, with nothing stored near its start
    const start = Math.floor(Date.now() / 900_000) * 900_000 - 900_000;
    await redis.set(`latest:${dev('meter').id}`, JSON.stringify({ ts: iso(start + 600_000), p_kw: 80, e_in_kwh: 50_100, q: 'ok' }));
    const res = await request(app).get('/api/site/snapshot').set('Authorization', `Bearer ${token}`);
    expect(res.body.demand).toMatchObject({ intervalStart: iso(start), quality: 'estimated', soFarKw: 80 });
  });

  it('needs a signed-in member', async () => {
    expect((await request(app).get('/api/site/snapshot')).status).toBe(401);
  });

  it('answers 503 without Redis', async () => {
    const bare = createApp({ env });
    expect((await request(bare).get('/api/site/snapshot').set('Authorization', `Bearer ${token}`)).status).toBe(503);
    expect((await request(bare).get('/api/site/stream').set('Authorization', `Bearer ${token}`)).status).toBe(503);
  });
});

describe('GET /api/site/stream', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  /** Opens the stream and collects events until `until` returns true or the time runs out. */
  const collect = async (until: (events: { event: string; data: unknown; at: number }[]) => boolean, ms = 3000) => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/site/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const events: { event: string; data: unknown; at: number }[] = [];
    let heartbeats = 0;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + ms;
    try {
      while (Date.now() < deadline && !until(events)) {
        const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
        if (!chunk || chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.startsWith(':')) heartbeats++;
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data), at: Date.now() });
        }
      }
    } finally {
      ctrl.abort();
    }
    return { events, heartbeats };
  };

  it('sends the snapshot first, then events published for the site, within 2 s', async () => {
    const published: number[] = [];
    const pub = new Redis(REDIS);
    const publishing = (async () => {
      // wait for the subscription, then publish a telemetry event and one for another site
      for (let i = 0; i < 50 && hub.listenerCount(SITE_ID) === 0; i++) await new Promise((r) => setTimeout(r, 20));
      await pub.publish(siteEventsChannel('650000000000000000000099'), JSON.stringify({ type: 'telemetry', deviceId: 'x', reading: {} }));
      published.push(Date.now());
      await pub.publish(
        siteEventsChannel(SITE_ID),
        JSON.stringify({ type: 'telemetry', deviceId: dev('invA').id, reading: { ts: iso(Date.now()), p_kw: 40, q: 'ok' } })
      );
      // A later event must still arrive: the stream stays subscribed after its first write.
      await new Promise((r) => setTimeout(r, 300));
      await pub.publish(
        siteEventsChannel(SITE_ID),
        JSON.stringify({ type: 'telemetry', deviceId: dev('invA').id, reading: { ts: iso(Date.now()), p_kw: 41, q: 'ok' } })
      );
    })();
    const { events } = await collect((e) => e.filter((x) => x.event === 'telemetry').length >= 2);
    await publishing;
    await pub.quit();

    expect(events[0].event).toBe('snapshot');
    const telemetry = events.filter((e) => e.event === 'telemetry');
    expect(telemetry).toHaveLength(2);
    expect(telemetry.map((t) => (t.data as { reading: { p_kw: number } }).reading.p_kw)).toEqual([40, 41]);
    expect(telemetry[0].at - published[0]).toBeLessThan(2000); // plan: within 5 s end to end
  });

  it('sends heartbeats and releases the subscription when the client leaves', async () => {
    const { heartbeats } = await collect(() => false, 700);
    expect(heartbeats).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 50 && hub.listenerCount(SITE_ID) > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(hub.listenerCount(SITE_ID)).toBe(0);
  });
});
