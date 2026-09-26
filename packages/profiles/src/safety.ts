import { checkWriteParams } from './index';
import type { WriteAction } from './schema';

// Gateway-side safety (plan P3-05, §0 rule 9). The gateway enforces these on its own, whatever the
// cloud sends: the simulator uses them now and the real gateway agent (P5-04) will too.
//   - an expired command is refused (it may have waited in a queue during an outage)
//   - settings must be within the device profile's limits
//   - no reserve below the hardware minimum (the site's battery floor)
//   - nothing runs longer than the action's maximum duration (its until, validTo or the command's
//     revertAt), and a time-limited action sent without an end gets one: it never runs open-ended
//   - after 15 minutes without the cloud, everything the cloud set is undone (see the gateway)

export const OFFLINE_REVERT_MS = 15 * 60_000;

export interface SafetyCommand {
  action: string;
  params: Record<string, unknown>;
  expiresAt: string;
  revertAt: string | null;
}

export interface SafetyState {
  now: number;
  batteryFloorPct: number;
}

export interface SafetyVerdict {
  problems: string[];
  /** When the action must stop by, if it is time-limited (ms since epoch). */
  endsAt: number | null;
}

const toMs = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
};

export const checkCommandSafety = (cmd: SafetyCommand, write: WriteAction | undefined, state: SafetyState): SafetyVerdict => {
  const problems: string[] = [];
  if ((toMs(cmd.expiresAt) ?? 0) <= state.now) return { problems: ['expired'], endsAt: null };
  if (cmd.action === 'revert') return { problems, endsAt: null }; // undoing is always allowed
  if (!write) return { problems: [`action ${cmd.action} is not supported`], endsAt: null };

  problems.push(...checkWriteParams(write, cmd.params));
  if (cmd.action === 'set_reserve' && typeof cmd.params.pct === 'number' && cmd.params.pct < state.batteryFloorPct)
    problems.push(`reserve ${cmd.params.pct}% is below the ${state.batteryFloorPct}% hardware minimum`);

  // The action's own end if it has one, otherwise the command's revert time.
  const end = toMs(cmd.params.until ?? cmd.params.validTo ?? cmd.revertAt ?? null);
  let endsAt: number | null = end;
  if (end !== null && end <= state.now) problems.push('ends in the past');
  if (write.maxDurationMin) {
    const maxMs = write.maxDurationMin * 60_000;
    if (end === null) endsAt = state.now + maxMs;
    else if (end - state.now > maxMs + 1000) problems.push(`runs ${Math.round((end - state.now) / 60_000)} min, longer than the ${write.maxDurationMin} min limit`);
  }
  return { problems, endsAt };
};
