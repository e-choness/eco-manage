import { z } from 'zod';
import { DEVICE_TYPES } from '../signs';
import { DEVICE_STATUSES } from '../models';
import { QUALITY, type TelemetryReading } from '../mqtt';

/** A device as the Devices list and detail show it. */
export interface DeviceView {
  id: string;
  siteId: string;
  type: (typeof DEVICE_TYPES)[number];
  name: string;
  profileId: string | null;
  address: string;
  role: string;
  status: (typeof DEVICE_STATUSES)[number];
  ratedKw: number | null;
  capacityKwh: number | null;
  lastSeenAt: string | null;
  commissionedAt: string | null;
  quality: (typeof QUALITY)[number] | null; // of the latest reading
  latest: TelemetryReading | null;
}

export interface DeviceDetail extends DeviceView {
  commissionedBy: { id: string; name: string } | null;
  profile: { id: string; vendor: string; model: string; protocol: string; pollMs: number; writeActions: string[]; fixes: string[] } | null;
  maintenance: { at: string; source: 'visit' | 'alert'; text: string }[]; // newest first
}

/** POST /api/devices (installer): add a device found by a scan; it starts as pending. */
export const createDeviceBody = z
  .object({
    type: z.enum(DEVICE_TYPES),
    name: z.string().trim().min(1).max(80),
    profileId: z.string().min(1).nullable().optional(),
    address: z.string().max(120).default(''),
    role: z.string().max(40).default(''),
    ratedKw: z.number().positive().nullable().optional(),
    capacityKwh: z.number().positive().nullable().optional(),
  })
  .strict();
export type CreateDeviceBody = z.infer<typeof createDeviceBody>;

/** PATCH /api/devices/:id (installer): rename, re-role, re-address, replace profile or ratings. */
export const patchDeviceBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    profileId: z.string().min(1).nullable(),
    address: z.string().max(120),
    role: z.string().max(40),
    ratedKw: z.number().positive().nullable(),
    capacityKwh: z.number().positive().nullable(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type PatchDeviceBody = z.infer<typeof patchDeviceBody>;

export const TELEMETRY_RESOLUTIONS = ['raw', '1m', '5m', '15m', 'h'] as const;
export type TelemetryResolution = (typeof TELEMETRY_RESOLUTIONS)[number];

/** GET /api/devices/:id/telemetry. Defaults to the last 24 h, hourly. */
export const telemetryQuery = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    res: z.enum(TELEMETRY_RESOLUTIONS).default('h'),
  })
  .strict();
export type TelemetryQuery = z.infer<typeof telemetryQuery>;

export interface TelemetryPoint {
  ts: string; // bucket start (or reading time for raw)
  p_kw: number; // average
  min_kw: number;
  max_kw: number;
  n: number; // readings in the bucket
  estimated: boolean; // any reading in the bucket was estimated (backfilled readings are real data)
}

export interface TelemetrySeries {
  points: TelemetryPoint[];
  res: TelemetryResolution;
  capped: boolean; // true when the requested resolution would exceed the point cap and a coarser one was used
}
