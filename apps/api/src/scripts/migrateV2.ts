import mongoose from 'mongoose';
import { DeviceProfile, Membership, Site, initModels, recordAudit } from '@ecomanage/db';
import { loadProfiles } from '@ecomanage/profiles';
import User from '../modules/auth/model';

export interface MigrationSummary {
  legacyDevicesMoved: number;
  legacyAlertsMoved: number;
  sitesCreated: number;
  profiles: number;
  legacyDropped: string[];
}

/**
 * v1 kept per-user documents in collections whose names v2 now uses for site data. v1 documents
 * (they have a userId and no siteId) move to `legacy_<name>`:
 * - `devices`: `--drop-legacy` removes `legacy_devices` with the other retired collections.
 * - `alerts`: v1 per-user alerts; v2 site alerts replaced them (P2-08).
 */
const moveLegacy = async (from: 'devices' | 'alerts'): Promise<number> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected');
  const source = db.collection(from);
  const legacy = await source.find({ userId: { $exists: true }, siteId: { $exists: false } }).toArray();
  if (legacy.length === 0) return 0;
  await db.collection(`legacy_${from}`).insertMany(legacy, { ordered: false }).catch((err: { code?: number }) => {
    if (err.code !== 11000) throw err; // already copied by an earlier, interrupted run
  });
  await source.deleteMany({ _id: { $in: legacy.map((d) => d._id) } });
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

// v1 collections replaced by the v2 model (P1-10): readings by telemetry, weather by forecasts,
// financial records by intervals x tariff, per-user devices by site devices, per-user alerts by
// site alerts (P2-08).
export const LEGACY_COLLECTIONS = ['energyreadings', 'weathers', 'financialrecords', 'legacy_devices', 'legacy_alerts'] as const;

const dropLegacyCollections = async (): Promise<string[]> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected');
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const dropped = LEGACY_COLLECTIONS.filter((c) => existing.has(c));
  for (const c of dropped) await db.dropCollection(c);
  return dropped;
};

/**
 * Brings a v1 database up to the v2 model. Safe to run any number of times. With dropLegacy the
 * retired v1 collections are deleted; nothing in them is carried over.
 */
export const migrateToV2 = async ({ dropLegacy = false } = {}): Promise<MigrationSummary> => {
  const legacyDevicesMoved = await moveLegacy('devices');
  const legacyAlertsMoved = await moveLegacy('alerts');
  await initModels();
  const sitesCreated = await createSitesForUsers();
  const profiles = await syncProfiles();
  const legacyDropped = dropLegacy ? await dropLegacyCollections() : [];
  return { legacyDevicesMoved, legacyAlertsMoved, sitesCreated, profiles, legacyDropped };
};
