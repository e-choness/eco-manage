// Document shapes shared by the API, services and web client (plan §2). Mongoose schemas live in
// packages/db; these are the plain types. Ids are strings on the wire.
import type { DeviceType } from './signs';
import type { Quality } from './mqtt';

export const ROLES = ['owner', 'manager', 'installer'] as const;
export type Role = (typeof ROLES)[number];

export const DEVICE_STATUSES = ['pending', 'live', 'stale', 'offline'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface Site {
  id: string;
  name: string;
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
