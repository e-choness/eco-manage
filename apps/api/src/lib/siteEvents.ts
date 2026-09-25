import type { Redis } from 'ioredis';
import { siteEventsChannel, type SiteEvent } from '@ecomanage/shared';
import { logger } from '../config/logger';

type Listener = (event: SiteEvent) => void;

/**
 * Fans Redis pub/sub site events out to this instance's SSE connections (plan §3.3). One
 * subscriber connection per API instance; a channel is subscribed while anyone listens to it.
 */
export class SiteEventHub {
  private readonly sub: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(redis: Redis) {
    this.sub = redis.duplicate();
    this.sub.on('message', (channel: string, message: string) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      let event: SiteEvent;
      try {
        event = JSON.parse(message) as SiteEvent;
      } catch {
        return;
      }
      for (const fn of set) fn(event);
    });
    this.sub.on('error', (err) => logger.error({ err: err.message }, 'event hub redis error'));
  }

  /** Listens to one site's events. Resolves once the subscription is active; call the result to stop. */
  async subscribe(siteId: string, fn: Listener): Promise<() => void> {
    const channel = siteEventsChannel(siteId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        void this.sub.unsubscribe(channel);
      }
    };
  }

  listenerCount(siteId: string): number {
    return this.listeners.get(siteEventsChannel(siteId))?.size ?? 0;
  }

  async close(): Promise<void> {
    this.sub.disconnect();
  }
}
