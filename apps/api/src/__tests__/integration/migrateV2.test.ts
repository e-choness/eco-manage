/**
 * P1-03: the v2 migration turns every user into a site owner, moves v1 devices out of the way,
 * and is idempotent. Runs against a copy of the seed data in a real MongoDB.
 */
import mongoose from 'mongoose';
import { AuditEvent, Device, DeviceProfile, Membership, Site } from '@ecomanage/db';
import { DEMO_DEVICES, DEMO_SITE_ID, DEMO_USERS } from '@ecomanage/shared';
import { connectTestDb, disconnectTestDb } from './db';
import { migrateToV2 } from '../../scripts/migrateV2';
import { seedDemoData } from '../../scripts/seedDemo';
import User from '../../modules/auth/model';

beforeAll(async () => {
  await connectTestDb('migrate');
});

afterAll(async () => {
  await disconnectTestDb();
});

const db = () => mongoose.connection.db!;

describe('migrating a v1 database', () => {
  beforeAll(async () => {
    // A v1 database: users and per-user devices in `devices`, no sites or memberships.
    const hash = '$2a$10$abcdefghijklmnopqrstuuCZq6Ixr4B1RBR6Nky7Lr7C3Gm1Z2tJO';
    const users = await db()
      .collection('users')
      .insertMany([
        { email: 'a@example.com', name: 'Ann', password: hash },
        { email: 'b@example.com', password: hash },
        { email: 'c@example.com', name: 'Cy', password: hash },
      ]);
    const [ua, ub] = Object.values(users.insertedIds);
    await db()
      .collection('devices')
      .insertMany([
        { userId: ua, name: 'Solar Panel A', type: 'solar', maxOutput: 5.5 },
        { userId: ub, name: 'Wind Turbine 1', type: 'wind', maxOutput: 10 },
      ]);
    await db()
      .collection('alerts')
      .insertMany([{ userId: ua, title: 'Low output', message: 'Solar Panel A is low', type: 'warning', read: false, resolved: false }]);
  });

  it('creates one site and owner membership per user, and moves v1 devices and alerts', async () => {
    const summary = await migrateToV2();
    expect(summary).toEqual({ legacyDevicesMoved: 2, legacyAlertsMoved: 1, sitesCreated: 3, profiles: 6, legacyDropped: [] });
    expect(await DeviceProfile.countDocuments()).toBe(6);

    const memberships = await Membership.find().lean();
    expect(memberships).toHaveLength(3);
    expect(memberships.every((m) => m.role === 'owner')).toBe(true);
    expect(new Set(memberships.map((m) => String(m.siteId))).size).toBe(3);

    const names = (await Site.find().lean()).map((s) => s.name).sort();
    expect(names).toEqual(["Ann's site", "Cy's site", "b@example.com's site"]);

    expect(await db().collection('devices').countDocuments({ userId: { $exists: true } })).toBe(0);
    expect(await db().collection('legacy_devices').countDocuments()).toBe(2);
    expect(await db().collection('alerts').countDocuments()).toBe(0);
    expect(await db().collection('legacy_alerts').countDocuments()).toBe(1);
    expect(await AuditEvent.countDocuments({ action: 'site.create' })).toBe(3);
  });

  it('changes nothing when run again', async () => {
    const summary = await migrateToV2();
    expect(summary).toEqual({ legacyDevicesMoved: 0, legacyAlertsMoved: 0, sitesCreated: 0, profiles: 6, legacyDropped: [] });
    expect(await DeviceProfile.countDocuments()).toBe(6);
    expect(await Site.countDocuments()).toBe(3);
    expect(await Membership.countDocuments()).toBe(3);
    expect(await db().collection('legacy_devices').countDocuments()).toBe(2);
    expect(await AuditEvent.countDocuments()).toBe(3);
  });

  it('drops the retired v1 collections only when asked', async () => {
    await db().collection('energyreadings').insertOne({ value: 1 });
    await db().collection('weathers').insertOne({ condition: 'sunny' });
    expect((await migrateToV2()).legacyDropped).toEqual([]);
    expect((await migrateToV2({ dropLegacy: true })).legacyDropped.sort()).toEqual(['energyreadings', 'legacy_alerts', 'legacy_devices', 'weathers']);
    const names = (await db().listCollections().toArray()).map((c) => c.name);
    expect(names).not.toContain('energyreadings');
    expect((await migrateToV2({ dropLegacy: true })).legacyDropped).toEqual([]);
  });

  it('only adds sites for users who have none', async () => {
    await User.create({ email: 'new@example.com', password: '$2a$10$abcdefghijklmnopqrstuuCZq6Ixr4B1RBR6Nky7Lr7C3Gm1Z2tJO' });
    expect((await migrateToV2()).sitesCreated).toBe(1);
    expect(await Membership.countDocuments()).toBe(4);
  });
});

describe('the demo seed', () => {
  beforeAll(async () => {
    await mongoose.connection.dropDatabase();
    await seedDemoData(() => {});
  });

  it('builds the demo site with its devices and three members', async () => {
    const site = await Site.findById(DEMO_SITE_ID).lean();
    expect(site).toMatchObject({ name: 'Maple Grove School', tz: 'America/Toronto', demandCapKw: 120 });

    const members = await Membership.find({ siteId: DEMO_SITE_ID }).lean();
    const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
    const roleOf = (email: string) => {
      const user = users.find((u) => u.email === email);
      return members.find((m) => String(m.userId) === String(user?._id))?.role;
    };
    for (const u of DEMO_USERS) expect(roleOf(u.email)).toBe(u.role);

    const devices = await Device.find({ siteId: DEMO_SITE_ID }).lean();
    expect(devices.map((d) => String(d._id)).sort()).toEqual(DEMO_DEVICES.map((d) => d.id).sort());
    expect(devices.every((d) => d.status === 'live')).toBe(true);
  });

  it('gives the other demo users their own sites through the migration', async () => {
    for (const email of ['demo2@ecomanage.io', 'demo3@ecomanage.io']) {
      const user = await User.findOne({ email }).lean();
      const m = await Membership.find({ userId: user?._id }).lean();
      expect(m).toHaveLength(1);
      expect(m[0].role).toBe('owner');
      expect(String(m[0].siteId)).not.toBe(DEMO_SITE_ID);
    }
  });

  it('can be run again without leftovers', async () => {
    await seedDemoData(() => {});
    expect(await Site.countDocuments()).toBe(3);
    expect(await Membership.countDocuments()).toBe(5);
    expect(await Device.countDocuments()).toBe(DEMO_DEVICES.length);
    expect(await User.countDocuments()).toBe(5);
  });
});
