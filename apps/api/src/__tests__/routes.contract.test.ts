/**
 * Route-level contract tests for the v1 API: status codes and response bodies through the full
 * middleware stack. Models are stubbed via mongoose.model(name), so these tests don't depend on
 * where the model files live.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createApp } from '../app';

const env = { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 10_000, AUTH_RATE_LIMIT_MAX: 10_000 };
const app = createApp({ env });

const model = (name: string) => mongoose.model(name);
const userId = new mongoose.Types.ObjectId();
const userDoc = {
  _id: userId,
  email: 'demo@ecomanage.io',
  name: 'Demo',
  refreshToken: 'stored',
  save: jest.fn().mockResolvedValue(undefined),
  toJSON: () => ({ _id: String(userId), email: 'demo@ecomanage.io', name: 'Demo' }),
};

const query = <T>(result: T) => {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'populate', 'limit', 'lean', 'select']) q[m] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  q.then = (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
};

let token: string;

beforeAll(() => {
  process.env.JWT_SECRET = 'contract-jwt';
  process.env.REFRESH_TOKEN_SECRET = 'contract-refresh';
  token = jwt.sign({ sub: String(userId) }, 'contract-jwt');
  // Loaded by createApp's imports; referenced here so the names are registered.
  ['User', 'Alert', 'LegacyDevice', 'EnergyReading', 'FinancialRecord', 'Recommendation', 'Weather'].forEach(model);
});

// Site access (P1-04): the caller is a member of one site with this role.
const siteId = new mongoose.Types.ObjectId();
let role = 'owner';

beforeEach(() => {
  role = 'owner';
  jest.spyOn(model('User'), 'findOne').mockImplementation(() => query(userDoc) as never);
  jest
    .spyOn(model('Membership'), 'findOne')
    .mockImplementation(() => query({ _id: new mongoose.Types.ObjectId(), userId, siteId, role, until: null }) as never);
  jest.spyOn(model('Membership'), 'find').mockImplementation(() => query([{ userId, siteId, role, until: null }]) as never);
  jest.spyOn(model('Site'), 'findById').mockImplementation(() => query({ _id: siteId, name: 'Site' }) as never);
  jest.spyOn(model('Site'), 'find').mockImplementation(() => query([{ _id: siteId, name: 'Site' }]) as never);
});

const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('health', () => {
  it('GET / and /ping', async () => {
    expect((await request(app).get('/')).body).toEqual({ message: 'Welcome to EcoManage API!' });
    expect((await request(app).get('/ping')).body).toEqual({ message: 'pong' });
  });

  it('unknown routes are 404', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});

describe('authentication guard', () => {
  it.each([
    ['get', '/api/auth/me'],
    ['put', '/api/auth/password'],
    ['put', '/api/auth/profile'],
    ['get', '/api/dashboard/overview'],
    ['get', '/api/dashboard/energy-flow'],
    ['get', '/api/analytics/production'],
    ['get', '/api/analytics/consumption'],
    ['get', '/api/alerts'],
    ['put', '/api/alerts/read'],
    ['get', '/api/devices'],
    ['post', '/api/devices'],
    ['get', '/api/financial/overview'],
    ['get', '/api/financial/history'],
    ['get', '/api/optimization/recommendations'],
    ['post', '/api/optimization/accept'],
  ] as const)('%s %s needs a token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
  });

  it('rejects an invalid token with 401', async () => {
    const res = await request(app).get('/api/alerts').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });
});

describe('auth', () => {
  it('login validates input', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.c' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Email and password are required' });
  });

  it('login with unknown email is 400', async () => {
    jest.spyOn(model('User'), 'findOne').mockImplementation(() => query(null) as never);
    const res = await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'pw' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Email or password is incorrect' });
  });

  it('register validates input', async () => {
    const res = await request(app).post('/api/auth/register').send({ password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Email and password are required' });
  });

  it('register reports duplicate emails as 400 with the service message', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'demo@ecomanage.io', password: 'pw' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'User with this email already exists' });
  });

  it('me returns the user without secrets', async () => {
    const res = await authed(request(app).get('/api/auth/me'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: String(userId),
      email: 'demo@ecomanage.io',
      name: 'Demo',
      memberships: [{ siteId: String(siteId), siteName: 'Site', role: 'owner', until: null }],
    });
  });

  it('password change validates input', async () => {
    const missing = await authed(request(app).put('/api/auth/password')).send({ currentPassword: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ message: 'Current password and new password are required' });

    const short = await authed(request(app).put('/api/auth/password')).send({ currentPassword: 'x', newPassword: '123' });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({ message: 'New password must be at least 6 characters' });
  });

  it('profile rejects a blank name', async () => {
    const res = await authed(request(app).put('/api/auth/profile')).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Name must be a non-empty string' });
  });

  it('profile updates the trimmed name', async () => {
    const update = jest
      .spyOn(model('User'), 'findOneAndUpdate')
      .mockResolvedValue({ toJSON: () => ({ name: 'New' }) } as never);
    const res = await authed(request(app).put('/api/auth/profile')).send({ name: '  New ' });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ _id: String(userId) }, { name: 'New' }, { new: true, upsert: false });
  });
});

describe('alerts', () => {
  it('lists alerts newest first', async () => {
    const find = jest.spyOn(model('Alert'), 'find').mockImplementation(() => query([{ title: 'a' }]) as never);
    const res = await authed(request(app).get('/api/alerts'));
    expect(res.body).toEqual({ alerts: [{ title: 'a' }] });
    expect(find).toHaveBeenCalledWith({ userId: expect.anything() });
  });

  it('mark read: 400 without id, 404 when missing, 200 when found', async () => {
    const update = jest.spyOn(model('Alert'), 'findOneAndUpdate');
    expect((await authed(request(app).put('/api/alerts/read')).send({})).body).toEqual({ error: 'Missing alertId' });

    update.mockResolvedValueOnce(null as never);
    const missing = await authed(request(app).put('/api/alerts/read')).send({ alertId: 'a1' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Alert not found' });

    update.mockResolvedValueOnce({ _id: 'a1', read: true } as never);
    const ok = await authed(request(app).put('/api/alerts/read')).send({ alertId: 'a1' });
    expect(ok.body).toEqual({ _id: 'a1', read: true });
    expect(update).toHaveBeenLastCalledWith({ _id: 'a1', userId: expect.anything() }, { read: true }, { new: true });
  });

  it('database errors become the route fallback', async () => {
    jest.spyOn(model('Alert'), 'find').mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await authed(request(app).get('/api/alerts'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch alerts' });
  });
});

describe('devices', () => {
  // Device writes are installer-only (P1-04).
  beforeEach(() => {
    role = 'installer';
  });

  it('validates required fields and type', async () => {
    const missing = await authed(request(app).post('/api/devices')).send({ name: 'x' });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({ error: 'Missing required fields: name, type' });

    const badType = await authed(request(app).post('/api/devices')).send({ name: 'x', type: 'nuclear' });
    expect(badType.status).toBe(400);
    expect(badType.body).toEqual({ error: 'Invalid device type. Must be: solar, wind, battery, or grid' });
  });

  it('creates with defaults', async () => {
    const create = jest.spyOn(model('LegacyDevice'), 'create').mockResolvedValue({ name: 'PV' } as never);
    const res = await authed(request(app).post('/api/devices')).send({ name: 'PV', type: 'solar' });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'PV', type: 'solar', maxOutput: 5, status: 'online', efficiency: 90 })
    );
  });

  it('lists devices', async () => {
    jest.spyOn(model('LegacyDevice'), 'find').mockImplementation(() => query([{ name: 'PV' }]) as never);
    expect((await authed(request(app).get('/api/devices'))).body).toEqual({ devices: [{ name: 'PV' }] });
  });
});

describe('optimization', () => {
  it('lists open recommendations', async () => {
    const find = jest.spyOn(model('Recommendation'), 'find').mockImplementation(() => query([{ title: 'r' }]) as never);
    const res = await authed(request(app).get('/api/optimization/recommendations'));
    expect(res.body).toEqual({ recommendations: [{ title: 'r' }] });
    expect(find).toHaveBeenCalledWith({ userId: expect.anything(), status: { $in: ['pending', 'accepted'] } });
  });

  it('accept: 400, 404, 200', async () => {
    const update = jest.spyOn(model('Recommendation'), 'findOneAndUpdate');
    const bad = await authed(request(app).post('/api/optimization/accept')).send({});
    expect(bad.body).toEqual({ error: 'Missing recommendationId' });

    update.mockResolvedValueOnce(null as never);
    expect((await authed(request(app).post('/api/optimization/accept')).send({ recommendationId: 'r' })).status).toBe(404);

    update.mockResolvedValueOnce({ status: 'accepted' } as never);
    const ok = await authed(request(app).post('/api/optimization/accept')).send({ recommendationId: 'r' });
    expect(ok.body).toEqual({ status: 'accepted' });
  });
});

describe('financial', () => {
  it('overview with no records is all zeros', async () => {
    jest.spyOn(model('FinancialRecord'), 'find').mockImplementation(() => query([]) as never);
    const res = await authed(request(app).get('/api/financial/overview'));
    expect(res.body).toEqual({ totalSavings: 0, monthlyRevenue: 0, roi: 0, paybackPeriod: 0, maintenanceCosts: 0 });
  });

  it('overview and history compute from records', async () => {
    const records = [
      { _id: 'f1', date: '2026-08-01T00:00:00.000Z', savings: 100, revenue: 50, costs: 10, category: 'm' },
      { _id: 'f2', date: '2026-07-01T00:00:00.000Z', savings: 200, revenue: 30.555, costs: 20, category: 'm' },
    ];
    jest.spyOn(model('FinancialRecord'), 'find').mockImplementation(() => query(records) as never);

    const overview = await authed(request(app).get('/api/financial/overview?period=6months'));
    expect(overview.body).toEqual({
      totalSavings: 300,
      monthlyRevenue: 40.28,
      roi: 3.51,
      paybackPeriod: 4.38,
      maintenanceCosts: 30,
    });

    const history = await authed(request(app).get('/api/financial/history?period=6months'));
    expect(history.body.period).toBe('6months');
    expect(history.body.data[1]).toEqual({
      id: 'f2',
      date: '2026-07-01T00:00:00.000Z',
      savings: 200,
      revenue: 30.55,
      costs: 20,
      category: 'm',
    });
  });
});

describe('analytics', () => {
  it('groups production by day and source', async () => {
    const readings = [
      { timestamp: new Date('2026-09-01T10:00:00Z'), value: 2, deviceId: { type: 'solar' } },
      { timestamp: new Date('2026-09-01T11:00:00Z'), value: 3, deviceId: { type: 'wind' } },
      { timestamp: new Date('2026-09-02T10:00:00Z'), value: 1.234, deviceId: null },
    ];
    jest.spyOn(model('EnergyReading'), 'find').mockImplementation(() => query(readings) as never);
    const res = await authed(request(app).get('/api/analytics/production?period=week'));
    expect(res.body).toEqual({
      period: 'week',
      data: [
        { date: '2026-09-01', solar: 2, wind: 3, total: 5 },
        { date: '2026-09-02', solar: 0, wind: 0, total: 1.23 },
      ],
    });
  });

  it('sums consumption by day with the default period', async () => {
    const readings = [
      { timestamp: new Date('2026-09-01T10:00:00Z'), value: 2 },
      { timestamp: new Date('2026-09-01T11:00:00Z'), value: 3 },
    ];
    jest.spyOn(model('EnergyReading'), 'find').mockImplementation(() => query(readings) as never);
    const res = await authed(request(app).get('/api/analytics/consumption'));
    expect(res.body).toEqual({ period: 'month', data: [{ date: '2026-09-01', consumption: 5 }] });
  });

  it('insight endpoint was removed (P0-05)', async () => {
    const res = await authed(request(app).post('/api/analytics/insight')).send({ data: 'x' });
    expect(res.status).toBe(404);
  });
});

// Dashboard numbers are covered against a real database in integration/p0-05-bugfixes.test.ts.
