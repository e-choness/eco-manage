import type { Redis } from 'ioredis';
import { demandNow, siteEventsChannel, type DemandNow, type SiteEvent, type TelemetryReading } from '@ecomanage/shared';
import { INTERVAL_MS, intervalOf } from './intervals';

/**
 * Publishes live events to Redis (`site:{siteId}:events`), which every API instance forwards to
 * its SSE clients. At most one event per key every `windowMs`; the latest value inside a window
 * is sent when the window ends, so a client is never more than one window behind (plan §3.3).
 */
export class EventPublisher {
  private readonly lastSent = new Map<string, number>();
  private readonly pending = new Map<string, { siteId: string; event: SiteEvent }>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly redis: Redis,
    private readonly windowMs = 5000,
    private readonly clock: () => number = Date.now
  ) {}

  private send(siteId: string, event: SiteEvent): void {
    void this.redis.publish(siteEventsChannel(siteId), JSON.stringify(event));
  }

  private throttle(key: string, siteId: string, event: SiteEvent): void {
    const now = this.clock();
    const last = this.lastSent.get(key) ?? -Infinity;
    if (now - last >= this.windowMs) {
      this.lastSent.set(key, now);
      this.send(siteId, event);
      return;
    }
    this.pending.set(key, { siteId, event });
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      this.lastSent.set(key, this.clock());
      this.send(p.siteId, p.event);
    }, last + this.windowMs - now);
    this.timers.set(key, timer);
  }

  telemetry(siteId: string, deviceId: string, reading: TelemetryReading): void {
    this.throttle(`t:${deviceId}`, siteId, { type: 'telemetry', deviceId, reading });
  }

  demand(siteId: string, demand: DemandNow, quality: 'ok' | 'estimated'): void {
    this.throttle(`d:${siteId}`, siteId, { type: 'demand', demand, quality });
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
  }
}

interface MeterState {
  start: number;
  startKwh: number;
  estimated: boolean;
  last: { ts: number; eIn: number; p: number };
}

/**
 * Follows each grid meter's import counter from the start of the current 15-minute interval, to
 * report demand so far and projected. The interval-start counter is carried from the last reading
 * before the boundary; without one (fresh start, gap) it is back-calculated and marked estimated.
 */
export class DemandTracker {
  private readonly meters = new Map<string, MeterState>();

  update(meterId: string, reading: TelemetryReading): { demand: DemandNow; quality: 'ok' | 'estimated' } | null {
    if (reading.e_in_kwh === undefined) return null;
    const ts = Date.parse(reading.ts);
    const start = intervalOf(new Date(ts)).getTime();
    const importKw = Math.max(0, reading.p_kw);
    let s = this.meters.get(meterId);
    if (s && ts <= s.last.ts) return null; // out of order: live demand only moves forward
    // A counter that goes backwards (meter replaced or reset) starts the interval over, estimated.
    const reset = s !== undefined && reading.e_in_kwh < s.last.eIn;
    if (s && reset) {
      s = { start, startKwh: reading.e_in_kwh - (importKw * (ts - start)) / 3_600_000, estimated: true, last: { ts, eIn: reading.e_in_kwh, p: reading.p_kw } };
      this.meters.set(meterId, s);
    } else if (!s || s.start !== start) {
      const carried = s && start - s.last.ts <= 60_000 && start - s.last.ts >= 0;
      s = {
        start,
        startKwh: carried ? s!.last.eIn + (Math.max(0, s!.last.p) * (start - s!.last.ts)) / 3_600_000 : reading.e_in_kwh - (importKw * (ts - start)) / 3_600_000,
        estimated: !carried && ts - start > 60_000,
        last: { ts, eIn: reading.e_in_kwh, p: reading.p_kw },
      };
      this.meters.set(meterId, s);
    }
    s.last = { ts, eIn: reading.e_in_kwh, p: reading.p_kw };
    const demand = demandNow({
      intervalStart: new Date(start),
      now: new Date(ts),
      minutes: INTERVAL_MS / 60_000,
      startKwh: s.startKwh,
      nowKwh: reading.e_in_kwh,
      currentKw: reading.p_kw,
    });
    return { demand, quality: s.estimated ? 'estimated' : 'ok' };
  }
}
