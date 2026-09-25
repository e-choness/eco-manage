/**
 * P0-03 security acceptance: refresh cookie, rate limit, CORS, helmet, and no credentials in logs.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { Writable } from 'stream';
import { createApp } from '../app';
import { createLogger } from '../config/logger';
import UserService from '../services/userService';
import { generateRefreshToken } from '../utils/auth';

jest.mock('../services/userService');
const mockUserService = UserService as jest.Mocked<typeof UserService>;

const env = {
  CORS_ORIGINS: ['http://localhost:5173'],
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 1000,
  AUTH_RATE_LIMIT_MAX: 3,
};

const captureLogs = () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger('trace', stream), text: () => lines.join('') };
};

const makeUser = (overrides: Record<string, unknown> = {}) => {
  const _id = new mongoose.Types.ObjectId();
  const user = {
    _id,
    email: 'test@example.com',
    refreshToken: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(undefined),
    toJSON: () => ({ _id, email: 'test@example.com' }),
    ...overrides,
  };
  return user;
};

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
});

describe('refresh token cookie', () => {
  it('returns 401 from /refresh when there is no cookie', async () => {
    const app = createApp({ env });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'ignored-body-token' });
    expect(res.status).toBe(401);
  });

  it('returns 401 from /refresh when the cookie token was rotated away', async () => {
    const user = makeUser();
    const stale = generateRefreshToken(user as never);
    user.refreshToken = 'a-newer-token';
    mockUserService.get.mockResolvedValue(user as never);

    const res = await request(createApp({ env })).post('/api/auth/refresh').set('Cookie', `em_rt=${stale}`);
    expect(res.status).toBe(401);
  });

  it('sets an httpOnly refresh cookie on login and keeps the refresh token out of the body', async () => {
    mockUserService.authenticateWithPassword.mockResolvedValue(makeUser() as never);

    const res = await request(createApp({ env }))
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'pw' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('refreshToken');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^em_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('rotates the cookie on /refresh and returns a new access token', async () => {
    const user = makeUser();
    const token = generateRefreshToken(user as never);
    user.refreshToken = token;
    mockUserService.get.mockResolvedValue(user as never);

    const res = await request(createApp({ env })).post('/api/auth/refresh').set('Cookie', `em_rt=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toEqual(expect.objectContaining({ email: 'test@example.com' }));
    expect(String(res.headers['set-cookie'])).toMatch(/^em_rt=/);
    expect(user.save).toHaveBeenCalled();
  });

  it('revokes the stored refresh token and clears the cookie on logout', async () => {
    const user = makeUser();
    const token = generateRefreshToken(user as never);
    user.refreshToken = token;
    mockUserService.get.mockResolvedValue(user as never);

    const res = await request(createApp({ env })).post('/api/auth/logout').set('Cookie', `em_rt=${token}`);

    expect(res.status).toBe(200);
    expect(user.refreshToken).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/em_rt=;/);
  });
});

describe('rate limiting', () => {
  it('returns 429 after the auth limit is reached', async () => {
    mockUserService.authenticateWithPassword.mockResolvedValue(null);
    const app = createApp({ env });
    const attempt = () => request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });

    for (let i = 0; i < env.AUTH_RATE_LIMIT_MAX; i++) {
      expect((await attempt()).status).toBe(400);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe(429);
  });

  it('applies the general API limit to non-auth routes', async () => {
    const app = createApp({ env: { ...env, RATE_LIMIT_MAX: 2 } });
    await request(app).get('/api/alerts');
    await request(app).get('/api/alerts');
    expect((await request(app).get('/api/alerts')).status).toBe(429);
  });
});

describe('CORS and headers', () => {
  it('allows listed origins with credentials', async () => {
    const res = await request(createApp({ env })).get('/ping').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow other origins', async () => {
    const res = await request(createApp({ env })).get('/ping').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets helmet security headers', async () => {
    const res = await request(createApp({ env })).get('/ping');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('logging', () => {
  it('never writes Authorization or cookie values to the logs', async () => {
    const { logger, text } = captureLogs();
    const app = createApp({ env, logger });

    await request(app)
      .get('/api/alerts')
      .set('Authorization', 'Bearer secret-access-token-123')
      .set('Cookie', 'em_rt=secret-refresh-token-456');

    expect(text()).toContain('"path":"/api/alerts"');
    expect(text()).not.toContain('secret-access-token-123');
    expect(text()).not.toContain('secret-refresh-token-456');
  });

  it('redacts credential fields if a request object is logged directly', () => {
    const { logger, text } = captureLogs();
    logger.info({ req: { headers: { authorization: 'Bearer leak', cookie: 'em_rt=leak' } }, body: { password: 'leak' } });
    expect(text()).not.toContain('leak');
    expect(text()).toContain('[redacted]');
  });
});
