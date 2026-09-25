import mongoose from 'mongoose';
import { DeviceProfile, Membership, Site, initModels, recordAudit } from '@ecomanage/db';
import { loadProfiles } from '@ecomanage/profiles';
import User from '../modules/auth/model';

export interface MigrationSummary {
  legacyDevicesMoved: number;
  sitesCreated: number;
  profiles: number;
}

/**
 * v1 kept per-user devices in `devices`. v2 uses that name for site devices, so v1 documents
 * (they have a userId and no siteId) move to `legacy_devices` until P1-10 deletes them.
 */
const moveLegacyDevices = async (): Promise<number> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected');
  const devices = db.collection('devices');
  const legacy = await devices.find({ userId: { $exists: true }, siteId: { $exists: false } }).toArray();
  if (legacy.length === 0) return 0;
  await db.collection('legacy_devices').insertMany(legacy, { ordered: false }).catch((err: { code?: number }) => {
    if (err.code !== 11000) throw err; // already copied by an earlier, interrupted run
  });
  await devices.deleteMany({ _id: { $in: legacy.map((d) => d._id) } });
  return legacy.length;
};

/** Every user without a membership gets their own site with an owner membership. */
const createSitesForUsers = async (): Promise<number> => {
  const members = await Membership.distinct('userId');
  const users = await User.find({ _id: { $nin: members } }).select('email name').lean();
  let created = 0;
  for (const user of users) {
    const site = await Site.create({ name: `${user.name || user.email}'s site` });
    try {
      await Membership.create({ userId: user._id, siteId: site._id, role: 'owner' });
    } catch (err) {
      // A concurrent run created the membership first: drop the extra site.
      await Site.deleteOne({ _id: site._id });
      if ((err as { code?: number }).code === 11000) continue;
      throw err;
    }
    await recordAudit({ siteId: site._id, userId: null, action: 'site.create', target: `site:${site._id}`, after: site.toJSON() });
    created++;
  }
  return created;
};

/** Mirrors the built-in profile library into `deviceProfiles` (upsert by id). */
const syncProfiles = async (): Promise<number> => {
  const profiles = [...loadProfiles().values()];
  await DeviceProfile.bulkWrite(
    profiles.map((p) => ({ updateOne: { filter: { id: p.id }, update: { $set: p }, upsert: true } }))
  );
  return profiles.length;
};

/** Brings a v1 database up to the v2 model. Safe to run any number of times. */
export const migrateToV2 = async (): Promise<MigrationSummary> => {
  const legacyDevicesMoved = await moveLegacyDevices();
  await initModels();
  const sitesCreated = await createSitesForUsers();
  const profiles = await syncProfiles();
  return { legacyDevicesMoved, sitesCreated, profiles };
};
