import type { ClientSession, Types } from 'mongoose';
import { AuditEvent } from './models';

type Id = Types.ObjectId | string;

export interface AuditInput {
  siteId: Id;
  userId: Id | null; // null for system actions (services, jobs)
  action: string; // e.g. "device.update", "membership.create"
  target: string; // e.g. "device:6500…0101"
  before?: unknown;
  after?: unknown;
}

// Plain JSON copies, so later changes to the documents don't alter the record.
const snapshot = (value: unknown): unknown =>
  value === undefined ? null : JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));

/** Writes one AuditEvent. Every mutating service call does this (plan §0.8). */
export const recordAudit = async (input: AuditInput, session?: ClientSession): Promise<void> => {
  await AuditEvent.create(
    [
      {
        siteId: input.siteId,
        userId: input.userId,
        action: input.action,
        target: input.target,
        before: snapshot(input.before),
        after: snapshot(input.after),
        ts: new Date(),
      },
    ],
    { session }
  );
};
