import { OFFLINE_REVERT_MS, checkCommandSafety, type DeviceProfile } from '@ecomanage/profiles';
import { commandMessage, type CommandAckMessage } from '@ecomanage/shared';
import type { Driver } from './drivers/types';
import type { PendingRevert, Store } from './store';

// Commands from the cloud (P5-04), with the same gateway-side safety as the simulator (P3-05):
// expired commands are refused, settings stay within the profile's limits and above the battery
// floor, nothing runs past its end (a time-limited action sent without one gets one), and after
// 15 minutes without the cloud everything it set is undone. Pending undos are kept in SQLite, so
// a restart still ends a command on time.

export interface CommandDevice {
  id: string;
  profile: DeviceProfile;
  driver: Driver;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export class Commands {
  private offlineSince: number | null = null;
  private revertedFor: number | null = null; // the outage already handled

  constructor(
    private readonly store: Store,
    private readonly device: (id: string) => CommandDevice | undefined,
    private readonly log: Logger,
    private readonly now: () => number = Date.now
  ) {}

  floorPct(): number {
    return this.store.get<number>('batteryFloorPct') ?? 10;
  }

  setFloor(pct: number): void {
    this.store.set('batteryFloorPct', pct);
  }

  async handle(payload: unknown): Promise<CommandAckMessage> {
    const ack = (ok: boolean, error?: string): CommandAckMessage => ({ ok, ts: new Date(this.now()).toISOString(), ...(error ? { error } : {}) });
    const parsed = commandMessage.safeParse(payload);
    if (!parsed.success) return ack(false, 'malformed command');
    const cmd = parsed.data;
    const d = this.device(cmd.deviceId);
    if (!d) return ack(false, 'unknown device');
    const write = d.profile.write[cmd.action];
    const verdict = checkCommandSafety(cmd, write, { now: this.now(), batteryFloorPct: this.floorPct() });
    if (verdict.problems.length) return ack(false, verdict.problems.join('; '));

    if (cmd.action === 'revert') {
      const failed = await this.undoAll((r) => r.deviceId === d.id);
      return failed ? ack(false, failed) : ack(true);
    }
    if (!write) return ack(false, `action ${cmd.action} is not supported`); // unreachable: the check refuses it
    // A time-limited action sent without an end gets one: nothing runs open-ended.
    const params = verdict.endsAt !== null && cmd.params.until === undefined && cmd.params.validTo === undefined ? { ...cmd.params, until: new Date(verdict.endsAt).toISOString() } : cmd.params;
    const key = `${d.id}:${cmd.action}`;
    try {
      const undo = await d.driver.write(cmd.action, params, write, verdict.endsAt);
      if (undo !== null && verdict.endsAt !== null) this.store.setRevert({ key, deviceId: d.id, action: cmd.action, at: verdict.endsAt, undo });
      // A setting without an end (a new permanent reserve) replaces any pending undo of it.
      else if (verdict.endsAt === null) this.store.dropRevert(key);
      this.log.info({ deviceId: d.id, action: cmd.action, until: verdict.endsAt ? new Date(verdict.endsAt).toISOString() : null }, 'command carried out');
      return ack(true);
    } catch (err) {
      return ack(false, err instanceof Error ? err.message : String(err));
    }
  }

  /** Undoes what matches; returns the first problem, or null. Failed undos stay for the next try. */
  private async undoAll(match: (r: PendingRevert) => boolean): Promise<string | null> {
    let problem: string | null = null;
    for (const r of this.store.reverts().filter(match)) {
      const d = this.device(r.deviceId);
      if (!d) {
        this.store.dropRevert(r.key);
        continue;
      }
      try {
        await d.driver.undo(r.action, r.undo, d.profile.write[r.action]);
        this.store.dropRevert(r.key);
        this.log.info({ deviceId: r.deviceId, action: r.action }, 'command undone');
      } catch (err) {
        problem ??= err instanceof Error ? err.message : String(err);
        this.log.warn({ deviceId: r.deviceId, action: r.action, err: problem }, 'undo failed; will retry');
      }
    }
    return problem;
  }

  /** Every few seconds: ends what is due, and undoes everything after 15 minutes offline. */
  async tick(online: boolean): Promise<void> {
    const now = this.now();
    await this.undoAll((r) => r.at <= now);
    if (online) {
      this.offlineSince = null;
      return;
    }
    this.offlineSince ??= now;
    if (now - this.offlineSince >= OFFLINE_REVERT_MS && this.revertedFor !== this.offlineSince) {
      this.log.warn({ offlineSince: new Date(this.offlineSince).toISOString() }, 'offline for 15 minutes: undoing everything the cloud set');
      if ((await this.undoAll(() => true)) === null) this.revertedFor = this.offlineSince;
    }
  }
}
