/**
 * P2-09: Settings → Notifications for the signed-in person on this site.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AuditEvent, Membership, NotificationPrefs, Site } from '@ecomanage/db';
import { connectTestDb, disconnectTestDb } from './db';
import { createApp } from '../../app';
import User from '../../modules/auth/model';
import { generatePasswordHash } from '../../utils/password';

const siteId = new mongoose.Types.ObjectId();
const tokens: Record<string, string> = {};
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectTestDb('notifications');
  process.env.JWT_SECRET = 'notif-jwt';
  app = createApp({ env: { CORS_ORIGINS: [], RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 1e6, AUTH_RATE_LIMIT_MAX: 1e6 } });
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto' });
  const password = await generatePasswordHash('pw123456');
  for (const role of ['owner', 'manager', 'installer'] as const) {
    const u = await User.create({ email: `${role}@example.com`, password });
    await Membership.create({ userId: u._id, siteId, role });
    tokens[role] = jwt.sign({ sub: String(u._id) }, 'notif-jwt');
  }
});

afterAll(async () => {
  await disconnectTestDb();
});

const as = (who: string, r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);

describe('/api/me/notifications', () => {
  it('starts from the defaults, sent to the sign-in address', async () => {
    const res = await as('manager', request(app).get('/api/me/notifications'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'manager@example.com', alerts: true, daily: true, recs: true, failures: true, quietFrom: '22:00', quietTo: '06:30', escalateMin: 30 });
  });

  it('saves changes for this person only, and audits them', async () => {
    const res = await as('manager', request(app).patch('/api/me/notifications')).send({ email: 'jamie@maplegrove.edu', daily: false, quietFrom: null, quietTo: null, escalateMin: 45 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'jamie@maplegrove.edu', daily: false, alerts: true, quietFrom: null, quietTo: null, escalateMin: 45 });
    expect((await as('manager', request(app).get('/api/me/notifications'))).body).toMatchObject({ daily: false, quietFrom: null });
    expect((await as('owner', request(app).get('/api/me/notifications'))).body).toMatchObject({ email: 'owner@example.com', daily: true });
    expect(await NotificationPrefs.countDocuments({ siteId })).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'notifications.update' })).toBe(1);
  });

  it('keeps command failures on for owners and managers, not for installers', async () => {
    for (const who of ['owner', 'manager']) {
      const res = await as(who, request(app).patch('/api/me/notifications')).send({ failures: false });
      expect(res.status).toBe(422);
    }
    expect((await as('installer', request(app).patch('/api/me/notifications')).send({ failures: false })).body).toMatchObject({ failures: false });
  });

  it('validates the fields', async () => {
    for (const body of [{ email: 'not-an-email' }, { quietFrom: '23:00' }, { escalateMin: 0 }, { sms: true }, {}])
      expect((await as('owner', request(app).patch('/api/me/notifications')).send(body)).status).toBe(400);
  });
});
