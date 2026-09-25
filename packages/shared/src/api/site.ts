import type { BatteryLive, DemandNow, SiteFlows } from '../live';
import type { TelemetryReading } from '../mqtt';
import type { DeviceStatus } from '../models';
import type { DeviceType } from '../signs';

/** GET /api/site/snapshot, also the first `snapshot` event on /api/site/stream. */
export interface SiteSnapshot {
  site: { id: string; name: string; tz: string; currency: string; demandCapKw: number | null; billDay: number };
  now: string;
  devices: {
    id: string;
    name: string;
    type: DeviceType;
    status: DeviceStatus;
    profileId: string | null;
    ratedKw: number | null;
    capacityKwh: number | null;
    lastSeenAt: string | null;
    latest: TelemetryReading | null;
  }[];
  flows: SiteFlows;
  battery: BatteryLive;
  demand: (DemandNow & { quality: 'ok' | 'estimated' }) | null;
  monthPeak: { kw: number; at: string } | null;
  gateway: { online: boolean; buffered: number; fw: string; receivedAt: string } | null;
}
