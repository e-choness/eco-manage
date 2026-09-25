import { Device } from '@ecomanage/db';
import { getProfile, type DeviceProfile } from '@ecomanage/profiles';
import type { DeviceType } from '@ecomanage/shared';

export interface KnownDevice {
  id: string;
  siteId: string;
  type: DeviceType;
  profile: DeviceProfile | undefined;
}

/**
 * Device lookups for ingest. Entries are cached for a short time; a miss reloads from MongoDB so
 * a newly commissioned device starts reporting within one message.
 */
export class DeviceCache {
  private readonly cache = new Map<string, { device: KnownDevice | null; at: number }>();

  constructor(private readonly ttlMs = 30_000) {}

  async get(deviceId: string, now = Date.now()): Promise<KnownDevice | null> {
    const hit = this.cache.get(deviceId);
    if (hit && now - hit.at < this.ttlMs && hit.device) return hit.device;
    // Unknown ids are cached for a shorter time so a device that is being added shows up soon.
    if (hit && !hit.device && now - hit.at < 5_000) return null;
    if (!/^[0-9a-f]{24}$/i.test(deviceId)) {
      this.cache.set(deviceId, { device: null, at: now });
      return null;
    }
    const doc = await Device.findById(deviceId).select('siteId type profileId').lean();
    const device: KnownDevice | null = doc
      ? { id: deviceId, siteId: String(doc.siteId), type: doc.type as DeviceType, profile: doc.profileId ? getProfile(doc.profileId) : undefined }
      : null;
    this.cache.set(deviceId, { device, at: now });
    return device;
  }

  clear(): void {
    this.cache.clear();
  }
}
