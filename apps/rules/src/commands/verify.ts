import type { TelemetryReading } from '@ecomanage/shared';

// Is the device doing what the command asked (plan P3-04 "verify from telemetry")? Judged from a
// reading taken after the gateway acknowledged the command.

export type Verdict = 'yes' | 'no' | 'wait';

const SHARE = 0.8; // of the asked power: a battery near its reserve or a cloud may shave a little
const VOLTS = 230;
const PHASES = 3;

type Step = { start: string; limitA?: number; mode?: number };

/** The schedule entry in force at `at` (the last one started), if any. */
const stepAt = (schedule: unknown, at: Date): Step | undefined =>
  ((schedule as Step[] | undefined) ?? []).filter((s) => Date.parse(s.start) <= at.getTime()).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).at(-1);

export const followsCommand = (
  cmd: { action: string; params: Record<string, unknown> },
  device: { ratedKw: number | null },
  reading: TelemetryReading,
  at: Date
): Verdict => {
  const p = cmd.params;
  const kw = reading.p_kw;
  switch (cmd.action) {
    case 'force_discharge':
      return kw >= Number(p.kw) * SHARE ? 'yes' : 'no';
    case 'force_charge':
      return kw <= -Number(p.kw) * SHARE ? 'yes' : 'no';
    case 'set_reserve':
      if (reading.reserve_pct === undefined) return 'wait';
      return Math.abs(reading.reserve_pct - Number(p.pct)) <= 1 ? 'yes' : 'no';
    case 'limit_current': {
      if (reading.limit_a !== undefined) return reading.limit_a <= Number(p.amps) + 0.5 ? 'yes' : 'no';
      return -kw <= (Number(p.amps) * VOLTS * PHASES) / 1000 + 1 ? 'yes' : 'no';
    }
    case 'set_charging_profile': {
      const step = stepAt(p.schedule, at);
      if (!step) return 'wait';
      if (step.limitA === 0) return Math.abs(kw) < 0.5 ? 'yes' : 'no';
      return reading.limit_a === undefined || Math.abs(reading.limit_a - Number(step.limitA)) <= 0.5 ? 'yes' : 'no';
    }
    case 'sg_mode':
      return reading.sg_mode === Number(p.mode) ? 'yes' : 'no';
    case 'sg_schedule': {
      const step = stepAt(p.schedule, at);
      if (!step) return 'wait'; // before the first step there is nothing to see yet
      return reading.sg_mode === Number(step.mode) ? 'yes' : 'no';
    }
    case 'export_limit':
      if (!device.ratedKw) return 'yes';
      return kw <= (device.ratedKw * Number(p.pct)) / 100 + 0.5 ? 'yes' : 'no';
    default:
      // restart, reset, revert, peak_shave_target …: nothing specific to see; a fresh reading will do.
      return 'yes';
  }
};
