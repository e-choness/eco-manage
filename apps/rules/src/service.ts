import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { siteEventsChannel, type AlertView, type DemandNow, type SiteEvent } from '@ecomanage/shared';
import { runChecks } from './checks';
import { loadContext } from './context';
import { liveAlerts, reconcile } from './reconcile';

// Runs the checks for a site whenever ingest publishes a reading for it (at most every
// `minGapMs`), and for every site on a timer so time-based checks (silence, slow acks) fire even
// when nothing arrives. Alert changes go out on the site's event channel like other live events.

const PV_CACHE_MS = 60_000;

export interface RulesServiceOptions {
  redis: Redis; // reads and publishes; subscriptions need their own connection
  logger: Logger;
  minGapMs?: number;
}

export class RulesService {
  private readonly demand = new Map<string, DemandNow>();
  private readonly pv = new Map<string, { at: number; ratios: Map<string, number[]> }>();
  private readonly dirty = new Set<string>();
  private readonly lastRun = new Map<string, number>();
  private running = false;

  constructor(private readonly opts: RulesServiceOptions) {}

  /** A message from a site's event channel. */
  onEvent(siteId: string, event: SiteEvent): void {
    if (event.type === 'alert') return; // our own
    if (event.type === 'demand') this.demand.set(siteId, event.demand);
    this.dirty.add(siteId);
  }

  /** Evaluates one site now and returns the alerts that changed. */
  async evaluate(siteId: string, now = new Date()): Promise<AlertView[]> {
    const live = await liveAlerts(siteId);
    const cached = this.pv.get(siteId);
    const loaded = await loadContext(siteId, {
      redis: this.opts.redis,
      now,
      demand: this.demand.get(siteId) ?? null,
      live,
      pvRatios: cached && now.getTime() - cached.at < PV_CACHE_MS ? cached.ratios : undefined,
    });
    if (!loaded) return [];
    if (!cached || now.getTime() - cached.at >= PV_CACHE_MS) this.pv.set(siteId, { at: now.getTime(), ratios: loaded.ctx.pvRatios });
    const changed = await reconcile(siteId, runChecks(loaded.ctx), now, live);
    for (const alert of changed) {
      const event: SiteEvent = { type: 'alert', alert };
      await this.opts.redis.publish(siteEventsChannel(siteId), JSON.stringify(event));
      this.opts.logger.info({ siteId, ruleId: alert.ruleId, deviceId: alert.deviceId, state: alert.state, count: alert.count }, 'alert');
    }
    this.lastRun.set(siteId, now.getTime());
    return changed;
  }

  /** Evaluates the sites with new readings that haven't been evaluated in the last `minGapMs`. */
  async runDirty(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const siteId of [...this.dirty]) {
        if (now.getTime() - (this.lastRun.get(siteId) ?? 0) < (this.opts.minGapMs ?? 2000)) continue;
        this.dirty.delete(siteId);
        await this.evaluate(siteId, now).catch((err: Error) => this.opts.logger.error({ siteId, err: err.message }, 'evaluation failed'));
      }
    } finally {
      this.running = false;
    }
  }

  /** Evaluates every given site (the timer pass). */
  async runAll(siteIds: string[], now = new Date()): Promise<void> {
    for (const siteId of siteIds) await this.evaluate(siteId, now).catch((err: Error) => this.opts.logger.error({ siteId, err: err.message }, 'evaluation failed'));
  }
}

