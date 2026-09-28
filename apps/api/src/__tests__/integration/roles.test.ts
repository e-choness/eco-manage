/**
 * P1-04: role × route matrix. Every route in the app must appear in ROUTES (checked against the
 * Express router), and each role gets 403 exactly where the matrix says so.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { Membership, Site } from '@ecomanage/db';
import type { Role } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { listRoutes } from './routes';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Access = 'public' | 'user' | readonly Role[];

const ALL: readonly Role[] = ['owner', 'manager', 'installer'];
const MONEY: readonly Role[] = ['owner', 'manager'];
const INSTALLER: readonly Role[] = ['installer'];
const OWNER: readonly Role[] = ['owner'];
const HARDWARE: readonly Role[] = ['owner', 'installer'];
const PLANNERS: readonly Role[] = ['owner', 'manager'];

// Who may call each route. 'public': no token; 'user': any signed-in user, no site needed.
const ROUTES: Record<string, Access> = {
  'get /': 'public',
  'get /ping': 'public',
  'post /api/auth/login': 'public',
  'post /api/auth/logout': 'public',
  'post /api/auth/refresh': 'public',
  'get /api/invites/:token': 'public',
  'post /api/invites/:token/accept': 'public',
  'get /api/auth/me': 'user',
  'put /api/auth/password': 'user',
  'put /api/auth/profile': 'user',
  'get /api/alerts/': ALL,
  'get /api/alerts/:id': ALL,
  'post /api/alerts/:id/ack': ALL,
  'post /api/alerts/:id/snooze': ALL,
  'post /api/alerts/:id/resolve': ALL,
  'post /api/alerts/:id/fix': ALL,
  'get /api/devices/': ALL,
  'post /api/devices/': INSTALLER,
  'post /api/devices/scan': INSTALLER,
  'get /api/devices/:id': ALL,
  'get /api/devices/:id/telemetry': ALL,
  'patch /api/devices/:id': INSTALLER,
  'delete /api/devices/:id': INSTALLER,
  'post /api/devices/:id/commission': INSTALLER,
  'post /api/devices/:id/maintenance': INSTALLER,
  'get /api/recommendations/': ALL,
  'post /api/recommendations/': MONEY,
  'get /api/recommendations/:id': ALL,
  'post /api/recommendations/:id/check': MONEY,
  'post /api/recommendations/:id/approve': MONEY,
  'post /api/recommendations/:id/decline': MONEY,
  'get /api/commands/': ALL,
  'get /api/commands/:id': ALL,
  'post /api/commands/:id/cancel': MONEY,
  'get /api/inbox/': ALL,
  'get /api/inbox/counts': ALL,
  'get /api/audit/': OWNER,
  'get /api/history/series': ALL,
  'get /api/history/totals': ALL,
  'post /api/exports/': ALL,
  'get /api/exports/:id': ALL,
  'get /api/exports/:id/file': ALL,
  'get /api/reports/': ALL,
  'post /api/reports/': ALL,
  'get /api/reports/:id/file': ALL,
  'delete /api/reports/:id': ALL,
  'get /api/report-links/:token': 'public',
  'post /api/site/invites/': OWNER,
  'delete /api/site/invites/:id': OWNER,
  'get /api/site/members/': OWNER,
  'patch /api/site/members/:id': OWNER,
  'delete /api/site/members/:id': OWNER,
  'get /api/rules/': ALL,
  'patch /api/rules/:ruleId': MONEY,
  'get /api/site/': ALL,
  'patch /api/site/': OWNER,
  'put /api/site/pv-arrays': HARDWARE,
  'patch /api/site/battery': HARDWARE,
  'get /api/site/gateway': ALL,
  'post /api/site/gateway/claim': HARDWARE,
  'get /api/site/model': ALL,
  'put /api/site/model': HARDWARE,
  'get /api/site/model/osm-footprint': HARDWARE,
  'get /api/site/model/uploads/': ALL,
  'post /api/site/model/uploads/': HARDWARE,
  'get /api/site/model/uploads/:id': ALL,
  'post /api/site/model/uploads/:id/use': HARDWARE,
  'delete /api/site/model/uploads/:id': HARDWARE,
  'get /api/site/today': ALL,
  'get /api/site/snapshot': ALL,
  'get /api/site/stream': ALL,
  'get /api/tariffs/': MONEY,
  'get /api/tariffs/templates': OWNER,
  'post /api/tariffs/': OWNER,
  'get /api/bills/': MONEY,
  'get /api/bills/range': MONEY,
  'get /api/bills/:period': MONEY,
  'get /api/bills/:period/statement': MONEY,
  'post /api/bills/:period/utility-bill': OWNER,
  'get /api/calendar/': ALL,
  'put /api/calendar/': PLANNERS,
  'get /api/me/notifications': ALL,
  'patch /api/me/notifications': ALL,
  'get /api/forecast/': ALL,
};


const pathFor = (route: string) =>
  route.split(' ')[1].replace(':id', new mongoose.Types.ObjectId().toString()).replace(':period', '2026-01');

let app: Express;
const tokens: Record<string, string> = {};
const siteA = new mongoose.Types.ObjectId();
const siteB = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await connectTestDb('roles');
  process.env.JWT_SECRET = 'roles-jwt';
  process.env.REFRESH_TOKEN_SECRET = 'roles-refresh';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });

  await Site.create([
    { _id: siteA, name: 'Site A', tz: 'America/Toronto' },
    { _id: siteB, name: 'Site B' },
  ]);
  const password = await generatePasswordHash('pw123456');
  const people: [string, Role | null, mongoose.Types.ObjectId, Date | null][] = [
    ['owner', 'owner', siteA, null],
    ['manager', 'manager', siteA, null],
    ['installer', 'installer', siteA, new Date('2099-01-01')],
    ['expired', 'installer', siteA, new Date('2020-01-01')],
    ['outsider', 'owner', siteB, null],
    ['nobody', null, siteA, null],
  ];
  for (const [key, role, siteId, until] of people) {
    const user = await User.create({ email: `${key}@example.com`, name: key, password });
    if (role) await Membership.create({ userId: user._id, siteId, role, until });
    tokens[key] = jwt.sign({ sub: String(user._id) }, 'roles-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

const call = (route: string, who?: string, siteHeader?: string) => {
  const [method, ] = route.split(' ') as [Method];
  let r = request(app)[method](pathFor(route));
  if (who) r = r.set('Authorization', `Bearer ${tokens[who]}`);
  if (siteHeader) r = r.set('X-Site-Id', siteHeader);
  return r.send({});
};

describe('route inventory', () => {
  it('lists every registered route in the matrix, and nothing else', () => {
    expect(listRoutes(app).sort()).toEqual(Object.keys(ROUTES).sort());
  });
});

describe('role matrix', () => {
  const siteRoutes = Object.entries(ROUTES).filter((e): e is [string, readonly Role[]] => Array.isArray(e[1]));

  it.each(siteRoutes)('%s', async (route, allowed) => {
    for (const role of ALL) {
      const res = await call(route, role);
      if (allowed.includes(role)) {
        expect({ role, status: res.status }).not.toEqual({ role, status: 403 });
        expect(res.status).not.toBe(401);
      } else {
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
        expect(res.body).toEqual({ error: { code: 403, message: `Requires role: ${allowed.join(' or ')}` } });
      }
    }
    expect((await call(route)).status).toBe(401);
    expect((await call(route, 'nobody')).status).toBe(403);
    expect((await call(route, 'expired')).status).toBe(403);
  });

  it.each(Object.entries(ROUTES).filter(([, a]) => a === 'user'))('%s needs only a signed-in user', async (route) => {
    expect((await call(route)).status).toBe(401);
    expect((await call(route, 'nobody')).status).not.toBe(403);
  });
});

describe('site selection', () => {
  const route = 'get /api/alerts/';

  it('uses the site named in X-Site-Id when the user belongs to it', async () => {
    expect((await call(route, 'outsider', String(siteB))).status).toBe(200);
  });

  it('refuses sites the user does not belong to, and malformed ids', async () => {
    expect((await call(route, 'outsider', String(siteA))).body).toEqual({ error: { code: 403, message: 'No access to this site' } });
    expect((await call(route, 'owner', 'not-an-id')).status).toBe(403);
  });
});

describe('/auth/me', () => {
  it('returns active memberships with site names', async () => {
    const res = await call('get /api/auth/me', 'installer');
    expect(res.body.memberships).toEqual([{ siteId: String(siteA), siteName: 'Site A', role: 'installer', until: '2099-01-01T00:00:00.000Z' }]);
  });

  it('leaves out expired memberships', async () => {
    expect((await call('get /api/auth/me', 'expired')).body.memberships).toEqual([]);
  });
});
