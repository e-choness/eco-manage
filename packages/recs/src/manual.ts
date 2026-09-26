import { checkWriteParams, getProfile } from '@ecomanage/profiles';
import type { Check } from '@ecomanage/shared';
import type { Action, RecContext } from './types';

// Manual requests from the Devices page (Backend Coverage §2: "same checks"): the device's
// profile must support the action, the settings must be within its limits and duration, the window
// must still be ahead, and a battery reserve can't go under the hardware floor.

export const MANUAL_RULE_ID = 'manual';

export const manualChecks = (ctx: RecContext, action: Action & { action: string }): Check[] => {
  const device = ctx.devices.find((d) => d.id === action.deviceId);
  const write = device?.profileId ? getProfile(device.profileId)?.write[action.action] : undefined;
  if (!device || !write) return [{ text: `${device?.name ?? 'The device'} supports ${action.action}`, pass: false }];
  const problems = checkWriteParams(write, action.params);
  const minutes = Math.round((action.window.end.getTime() - action.window.start.getTime()) / 60_000);
  const checks: Check[] = [
    { text: `${device.name} supports ${action.action}`, pass: true },
    { text: problems.length ? `Settings: ${problems.join('; ')}` : "Settings within the device's limits", pass: problems.length === 0 },
    { text: 'Ends in the future', pass: action.window.end > ctx.now },
  ];
  if (write.maxDurationMin) checks.push({ text: `${minutes} min, within the ${write.maxDurationMin} min limit`, pass: minutes <= write.maxDurationMin });
  if (device.type === 'battery' && action.action === 'set_reserve' && ctx.battery)
    checks.push({ text: `At least the ${ctx.battery.floorPct}% hardware minimum`, pass: Number(action.params.pct) >= ctx.battery.floorPct });
  return checks;
};
