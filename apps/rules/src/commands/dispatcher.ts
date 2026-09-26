import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { Command, Device, Recommendation, createRevertCommand, type CommandDoc, type DeviceDoc } from '@ecomanage/db';
import { siteEventsChannel, type CommandMessage, type SiteEvent, type TelemetryReading } from '@ecomanage/shared';
import { followsCommand } from './verify';

// Commands (plan P3-04). Approved commands wait for their window, then:
//   created ──send at window start──▶ sent ──ack (ingest)──▶ acked ──telemetry match──▶ verified
//      │                               └─no ack in 60 s──▶ failed (the command-failed alert opens)
//      └─past expiresAt──▶ failed                      at revertAt (or on cancel) ──▶ revert ──ack──▶ reverted
// A revert is its own command (revertOf), so it is sent, acked and tracked the same way. The
// recommendation behind a command follows its status.

export interface CommandLink {
  sendCommand(siteId: string, commandId: string, command: CommandMessage): Promise<boolean>;
}

export interface DispatcherOptions {
  redis: Redis;
  link: CommandLink;
  logger: Logger;
  ackTimeoutMs?: number;
  verifyWithinMs?: number;
}

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export class CommandDispatcher {
  private readonly ackTimeoutMs: number;
  private readonly verifyWithinMs: number;

  constructor(private readonly opts: DispatcherOptions) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 60_000;
    this.verifyWithinMs = opts.verifyWithinMs ?? 5 * 60_000;
  }

  async tick(now = new Date()): Promise<void> {
    await this.send(now);
    await this.timeouts(now);
    await this.verify(now);
    await this.revert(now);
    await this.follow();
  }

  private async event(siteId: unknown, event: SiteEvent) {
    await this.opts.redis.publish(siteEventsChannel(String(siteId)), JSON.stringify(event));
  }

  private async changed(c: CommandDoc, status: string) {
    await this.event(c.siteId, { type: 'command', commandId: String(c._id), deviceId: c.deviceId, status });
    this.opts.logger.info({ siteId: String(c.siteId), commandId: String(c._id), action: c.action, status, revertOf: c.revertOf ? String(c.revertOf) : undefined }, 'command');
  }

  /** The recommendation behind a command follows it. */
  private async recommendation(c: CommandDoc, status: string) {
    if (!c.recommendationId) return;
    const res = await Recommendation.updateOne({ _id: c.recommendationId, status: { $ne: status } }, { $set: { status } });
    if (res.modifiedCount) await this.event(c.siteId, { type: 'inbox', itemType: 'active', itemId: String(c.recommendationId) });
  }

  private async latest(deviceId: string): Promise<TelemetryReading | null> {
    return parse<TelemetryReading>(await this.opts.redis.get(`latest:${deviceId}`));
  }

  /** Publishes commands whose time has come; ones that can no longer arrive in time fail. */
  private async send(now: Date) {
    const due = await Command.find({ status: 'created', $or: [{ sendAt: null }, { sendAt: { $lte: now } }] }).lean<CommandDoc[]>();
    for (const c of due) {
      if (c.expiresAt <= now) {
        const failed = await Command.findOneAndUpdate({ _id: c._id, status: 'created' }, { $set: { status: 'failed', failedAt: now, error: 'Expired before it could be sent' } }, { new: true }).lean<CommandDoc>();
        if (failed) {
          await this.changed(failed, 'failed');
          await this.recommendation(failed, 'failed');
        }
        continue;
      }
      // Remember what a reserve change undoes to (the reserve before it).
      let revertParams = c.revertParams ?? null;
      if (!c.revertOf && c.action === 'set_reserve' && !revertParams) {
        const r = await this.latest(c.deviceId);
        // Without the current reserve the change couldn't be undone: wait for a reading.
        if (r?.reserve_pct === undefined) continue;
        revertParams = { pct: r.reserve_pct };
      }
      const message: CommandMessage = {
        deviceId: c.deviceId,
        action: c.action,
        params: (c.params as Record<string, unknown>) ?? {},
        expiresAt: c.expiresAt.toISOString(),
        revertAt: c.revertAt?.toISOString() ?? null,
      };
      // Mark it sent first: the gateway can answer within milliseconds, before the publish
      // returns, and ingest only takes acks for commands that have gone out.
      const updated = await Command.findOneAndUpdate({ _id: c._id, status: 'created' }, { $set: { status: 'sent', sentAt: now, revertParams } }, { new: true }).lean<CommandDoc>();
      if (!updated) continue; // another dispatcher took it
      if (!(await this.opts.link.sendCommand(String(c.siteId), String(c._id), message))) {
        // Broker unreachable: back to waiting, and try again next tick until it expires.
        await Command.updateOne({ _id: c._id, status: 'sent' }, { $set: { status: 'created', sentAt: null } });
        continue;
      }
      await this.changed(updated, 'sent');
      if (!updated.revertOf) await this.recommendation(updated, 'sent');
    }
  }

  /** No acknowledgement within 60 s: failed (the rules service's command-failed alert opens). */
  private async timeouts(now: Date) {
    const late = await Command.find({ status: 'sent', sentAt: { $lte: new Date(now.getTime() - this.ackTimeoutMs) } }).lean<CommandDoc[]>();
    for (const c of late) {
      const failed = await Command.findOneAndUpdate(
        { _id: c._id, status: 'sent' },
        { $set: { status: 'failed', failedAt: now, error: `No acknowledgement within ${Math.round(this.ackTimeoutMs / 1000)} s` } },
        { new: true }
      ).lean<CommandDoc>();
      if (!failed) continue;
      await this.changed(failed, 'failed');
      if (!failed.revertOf) await this.recommendation(failed, 'failed');
    }
  }

  /**
   * Acknowledged commands are checked against telemetry newer than the ack. A revert is done once
   * acknowledged. A command the device doesn't follow within 5 minutes has failed.
   */
  private async verify(now: Date) {
    const acked = await Command.find({ status: 'acked' }).lean<CommandDoc[]>();
    for (const c of acked) {
      if (c.revertOf) {
        const done = await Command.findOneAndUpdate({ _id: c._id, status: 'acked' }, { $set: { status: 'verified', verifiedAt: now } }, { new: true }).lean<CommandDoc>();
        if (!done) continue;
        await this.changed(done, 'verified');
        const parent = await Command.findOneAndUpdate(
          { _id: c.revertOf, revertedAt: null },
          [{ $set: { revertedAt: now, status: { $cond: [{ $in: ['$status', ['acked', 'verified']] }, 'reverted', '$status'] } } }],
          { new: true }
        ).lean<CommandDoc>();
        if (parent) {
          await this.changed(parent, parent.status);
          if (parent.status === 'reverted') await this.recommendation(parent, 'reverted');
        }
        continue;
      }
      const reading = await this.latest(c.deviceId);
      const ackedAt = c.ackedAt ?? c.sentAt ?? now;
      const fresh = reading && Date.parse(reading.ts) > ackedAt.getTime();
      if (fresh) {
        const device = await Device.findById(c.deviceId).select('ratedKw').lean<DeviceDoc>();
        const verdict = followsCommand({ action: c.action, params: (c.params as Record<string, unknown>) ?? {} }, { ratedKw: device?.ratedKw ?? null }, reading, now);
        if (verdict === 'yes') {
          const ok = await Command.findOneAndUpdate({ _id: c._id, status: 'acked' }, { $set: { status: 'verified', verifiedAt: now } }, { new: true }).lean<CommandDoc>();
          if (ok) {
            await this.changed(ok, 'verified');
            await this.recommendation(ok, 'verified');
          }
          continue;
        }
      }
      if (now.getTime() - ackedAt.getTime() > this.verifyWithinMs) {
        const failed = await Command.findOneAndUpdate(
          { _id: c._id, status: 'acked' },
          { $set: { status: 'failed', failedAt: now, error: 'Acknowledged, but the device did not follow it (telemetry)' } },
          { new: true }
        ).lean<CommandDoc>();
        if (failed) {
          await this.changed(failed, 'failed');
          await this.recommendation(failed, 'failed');
          // It may have half-applied: undo it.
          await createRevertCommand(failed, now);
        }
      }
    }
  }

  /** At revertAt, running commands get their revert. */
  private async revert(now: Date) {
    const due = await Command.find({ status: { $in: ['acked', 'verified'] }, revertOf: null, revertAt: { $ne: null, $lte: now }, revertedAt: null }).lean<CommandDoc[]>();
    for (const c of due) await createRevertCommand(c, now);
  }

  /** Ingest records acks and gateway failures on the command; the recommendation catches up here. */
  private async follow() {
    const waiting = await Recommendation.find({ status: 'sent', commandId: { $ne: null } }).select('commandId').lean();
    if (!waiting.length) return;
    const commands = await Command.find({ _id: { $in: waiting.map((r) => r.commandId) }, status: { $in: ['acked', 'failed'] } }).lean<CommandDoc[]>();
    for (const c of commands) await this.recommendation(c, c.status);
  }
}
