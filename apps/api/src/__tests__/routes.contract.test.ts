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
  ['User', 'LegacyRecommendation'].forEach(model);
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
    ['get', '/api/alerts'],
    ['post', '/api/alerts/650000000000000000000999/ack'],
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

// v2 devices (P1-09) and alerts (P2-08) are covered in integration/.

describe('optimization', () => {
  it('lists open recommendations', async () => {
    const find = jest.spyOn(model('LegacyRecommendation'), 'find').mockImplementation(() => query([{ title: 'r' }]) as never);
    const res = await authed(request(app).get('/api/optimization/recommendations'));
    expect(res.body).toEqual({ recommendations: [{ title: 'r' }] });
    expect(find).toHaveBeenCalledWith({ userId: expect.anything(), status: { $in: ['pending', 'accepted'] } });
  });

  it('accept: 400, 404, 200', async () => {
    const update = jest.spyOn(model('LegacyRecommendation'), 'findOneAndUpdate');
    const bad = await authed(request(app).post('/api/optimization/accept')).send({});
    expect(bad.body).toEqual({ error: 'Missing recommendationId' });

    update.mockResolvedValueOnce(null as never);
    expect((await authed(request(app).post('/api/optimization/accept')).send({ recommendationId: 'r' })).status).toBe(404);

    update.mockResolvedValueOnce({ status: 'accepted' } as never);
    const ok = await authed(request(app).post('/api/optimization/accept')).send({ recommendationId: 'r' });
    expect(ok.body).toEqual({ status: 'accepted' });
  });
});

// Financial, analytics and dashboard left with the v1 data model (P1-10).
