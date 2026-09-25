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
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Access = 'public' | 'user' | readonly Role[];

const ALL: readonly Role[] = ['owner', 'manager', 'installer'];
const MONEY: readonly Role[] = ['owner', 'manager'];
const INSTALLER: readonly Role[] = ['installer'];

// Who may call each route. 'public': no token; 'user': any signed-in user, no site needed.
const ROUTES: Record<string, Access> = {
  'get /': 'public',
  'get /ping': 'public',
  'post /api/auth/login': 'public',
  'post /api/auth/register': 'public',
  'post /api/auth/logout': 'public',
  'post /api/auth/refresh': 'public',
  'get /api/auth/me': 'user',
  'put /api/auth/password': 'user',
  'put /api/auth/profile': 'user',
  'get /api/dashboard/overview': ALL,
  'get /api/dashboard/energy-flow': ALL,
  'get /api/analytics/production': ALL,
  'get /api/analytics/consumption': ALL,
  'get /api/alerts/': ALL,
  'put /api/alerts/read': ALL,
  'get /api/devices/': ALL,
  'post /api/devices/': INSTALLER,
  'get /api/devices/:id': ALL,
  'get /api/devices/:id/telemetry': ALL,
  'patch /api/devices/:id': INSTALLER,
  'delete /api/devices/:id': INSTALLER,
  'get /api/financial/overview': MONEY,
  'get /api/financial/history': MONEY,
  'get /api/optimization/recommendations': ALL,
  'post /api/optimization/accept': MONEY,
  'post /api/optimization/dismiss': MONEY,
  'get /api/site/snapshot': ALL,
  'get /api/site/stream': ALL,
};

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

// Lists "method /path" for every route registered on the app, including mounted routers.
const listRoutes = (app: Express): string[] => {
  const out: string[] = [];
  const mountOf = (re: RegExp) =>
    re.source === '^\\/?(?=\\/|$)' ? '' : re.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m} ${prefix}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountOf(layer.regexp));
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '');
  return out;
};

const pathFor = (route: string) => route.split(' ')[1].replace(':id', new mongoose.Types.ObjectId().toString());

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
