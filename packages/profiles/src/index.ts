import type { DeviceType } from '@ecomanage/shared';
import { deviceProfile, type DeviceProfile, type WriteAction } from './schema';
import sunspecInverter from './profiles/sunspec-inverter.json';
import sunspecStorage802 from './profiles/sunspec-storage-802.json';
import ctMeter3ph from './profiles/ct-meter-3ph.json';
import ocpp16Generic from './profiles/ocpp16-generic.json';
import sgReadyHeatpump from './profiles/sg-ready-heatpump.json';
import gateway from './profiles/gateway.json';

export { deviceProfile, TELEMETRY_FIELDS } from './schema';
export type { DeviceProfile, WriteAction } from './schema';

const RAW: unknown[] = [sunspecInverter, sunspecStorage802, ctMeter3ph, ocpp16Generic, sgReadyHeatpump, gateway];

/** Parses and validates profile JSON; throws with the profile id and the problems found. */
export const parseProfiles = (raw: unknown[]): Map<string, DeviceProfile> => {
  const out = new Map<string, DeviceProfile>();
  for (const r of raw) {
    const parsed = deviceProfile.safeParse(r);
    if (!parsed.success) {
      const id = (r as { id?: string })?.id ?? '(no id)';
      throw new Error(`Invalid device profile ${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
    if (out.has(parsed.data.id)) throw new Error(`Duplicate device profile ${parsed.data.id}`);
    out.set(parsed.data.id, parsed.data);
  }
  return out;
};

let library: Map<string, DeviceProfile> | null = null;

/** The built-in profile library, validated once. The simulator, ingest and the API all use it. */
export const loadProfiles = (): Map<string, DeviceProfile> => (library ??= parseProfiles(RAW));

export const getProfile = (id: string): DeviceProfile | undefined => loadProfiles().get(id);

export const profilesFor = (type: DeviceType): DeviceProfile[] => [...loadProfiles().values()].filter((p) => p.deviceTypes.includes(type));

/** Fields a device with this profile may report; every reading also has ts, p_kw and q. */
export const allowedFields = (profile: DeviceProfile): Set<string> => new Set(['ts', 'q', 'p_kw', ...profile.fields]);

/** Readings fields not declared by the profile, empty if the reading fits it. */
export const undeclaredFields = (profile: DeviceProfile, reading: Record<string, unknown>): string[] => {
  const allowed = allowedFields(profile);
  return Object.keys(reading).filter((k) => !allowed.has(k));
};

/** Checks command params against a write action's limits. Returns problems; empty means OK. */
export const checkWriteParams = (action: WriteAction, params: Record<string, unknown>): string[] => {
  const problems: string[] = [];
  for (const [name, spec] of Object.entries(action.params)) {
    const value = params[name];
    if (value === undefined) {
      problems.push(`${name} is required`);
      continue;
    }
    if (spec.type === 'number' || spec.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${name} must be a number`);
      else if (spec.type === 'integer' && !Number.isInteger(value)) problems.push(`${name} must be a whole number`);
      else if (spec.min !== undefined && value < spec.min) problems.push(`${name} must be at least ${spec.min}${spec.unit ?? ''}`);
      else if (spec.max !== undefined && value > spec.max) problems.push(`${name} must be at most ${spec.max}${spec.unit ?? ''}`);
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') problems.push(`${name} must be true or false`);
  }
  for (const name of Object.keys(params)) if (!(name in action.params)) problems.push(`${name} is not a parameter of this action`);
  return problems;
};
