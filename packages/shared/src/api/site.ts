import type { BatteryLive, DemandNow, SiteFlows } from '../live';
import type { TelemetryReading } from '../mqtt';
import type { DeviceStatus } from '../models';
import type { DeviceType } from '../signs';
import type { PriceSegment } from '../tariff';

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

/** GET /api/site/today: Home's price strip and bill line (P4-03). */
export interface SiteToday {
  date: string; // local YYYY-MM-DD
  currency: string;
  prices: PriceSegment[] | null; // null without a (gap-free) tariff for today
  // The open billing period so far; null for installers (no money views) or before the first bill.
  bill: { period: string; totalCents: number; projectedCents: number | null; savedCents: number | null } | null;
}
