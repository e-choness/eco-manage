import { Device } from '@ecomanage/db';

// No data for 60 s: stale. For 5 min: offline (Data and Device Audit §4 step 6). The alert for a
// silent device opens at 5 min in the rules service (P2-07).
export const STALE_AFTER_MS = 60_000;
export const OFFLINE_AFTER_MS = 5 * 60_000;

/** Marks live devices stale and stale devices offline. Returns how many changed. */
export const markSilentDevices = async (now = new Date()): Promise<{ stale: number; offline: number }> => {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const offlineBefore = new Date(now.getTime() - OFFLINE_AFTER_MS);
  const offline = await Device.updateMany(
    { status: { $in: ['live', 'stale'] }, type: { $ne: 'gateway' }, lastSeenAt: { $lt: offlineBefore } },
    { $set: { status: 'offline' } }
  );
  const stale = await Device.updateMany(
    { status: 'live', type: { $ne: 'gateway' }, lastSeenAt: { $lt: staleBefore } },
    { $set: { status: 'stale' } }
  );
  return { stale: stale.modifiedCount, offline: offline.modifiedCount };
};
