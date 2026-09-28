// Document shapes shared by the API, services and web client (plan §2). Mongoose schemas live in
// packages/db; these are the plain types. Ids are strings on the wire.
import type { DeviceType } from './signs';
import type { Quality } from './mqtt';

export const ROLES = ['owner', 'manager', 'installer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Who manages a person's access: `app` (invited and changed in Settings → People) or
 * `provisioning` (a provisioning plan, e.g. exported from a directory or CRM; applying the plan
 * again may change or, with --prune, remove it).
 */
export const ACCESS_SOURCES = ['app', 'provisioning'] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const DEVICE_STATUSES = ['pending', 'live', 'stale', 'offline'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface Site {
  id: string;
  name: string;
  externalId: string | null;
  address: string;
  tz: string;
  lat: number;
  lon: number;
  currency: string;
  billDay: number;
  demandCapKw: number;
  gatewayId: string | null;
}

export interface Membership {
  id: string;
  userId: string;
  siteId: string;
  role: Role;
  until: string | null;
  source: AccessSource;
}

export interface Device {
  id: string;
  siteId: string;
  type: DeviceType;
  name: string;
  profileId: string | null;
  address: string;
  role: string;
  status: DeviceStatus;
  ratedKw: number | null;
  capacityKwh: number | null;
  lastSeenAt: string | null;
  commissionedAt: string | null;
  commissionedBy: string | null;
}

export interface Interval15 {
  siteId: string;
  start: string;
  pv: number;
  used: number;
  batt: number;
  grid: number;
  export: number;
  bld: number;
  hp: number;
  ev: number;
  demandKw: number;
  quality: Quality;
}

export interface AuditEvent {
  siteId: string;
  userId: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  ts: string;
}
