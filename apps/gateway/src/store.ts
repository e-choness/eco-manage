import { DatabaseSync } from 'node:sqlite';
import type { TelemetryReading } from '@ecomanage/shared';

// The gateway's own storage (P5-04), in SQLite (node:sqlite, nothing to build):
//   buffer   readings not yet delivered, in arrival order, kept for 7 days
//   devices  the devices it polls (commissioning adds them)
//   reverts  what to undo and when, so a restart still ends a time-limited command
//   kv       small settings: the battery floor, the certificate once claimed

export const BUFFER_DAYS = 7;
const DAY = 86_400_000;

export interface Buffered {
  id: number;
  deviceId: string;
  reading: TelemetryReading;
}

export interface PendingRevert {
  key: string; // `${deviceId}:${action}`, one per action on a device
  deviceId: string;
  action: string;
  at: number; // ms since epoch
  undo: unknown; // what the driver needs to put it back
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS buffer (id INTEGER PRIMARY KEY AUTOINCREMENT, device TEXT NOT NULL, ts INTEGER NOT NULL, reading TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS buffer_ts ON buffer (ts);
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reverts (key TEXT PRIMARY KEY, device TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL, undo TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  // ---- buffer ----------------------------------------------------------------------------------

  push(deviceId: string, reading: TelemetryReading): void {
    this.db.prepare('INSERT INTO buffer (device, ts, reading) VALUES (?, ?, ?)').run(deviceId, Date.parse(reading.ts), JSON.stringify(reading));
  }

  /** The oldest readings first. */
  peek(limit: number): Buffered[] {
    const rows = this.db.prepare('SELECT id, device, reading FROM buffer ORDER BY id LIMIT ?').all(limit) as { id: number; device: string; reading: string }[];
    return rows.map((r) => ({ id: r.id, deviceId: r.device, reading: JSON.parse(r.reading) as TelemetryReading }));
  }

  /** Removes delivered readings (everything up to and including `lastId`). */
  ack(lastId: number): void {
    this.db.prepare('DELETE FROM buffer WHERE id <= ?').run(lastId);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM buffer').get() as { n: number }).n;
  }

  oldestTs(): string | null {
    const row = this.db.prepare('SELECT reading FROM buffer ORDER BY id LIMIT 1').get() as { reading: string } | undefined;
    return row ? (JSON.parse(row.reading) as TelemetryReading).ts : null;
  }

  /** Drops readings older than the buffer keeps. Returns how many went. */
  prune(now = Date.now()): number {
    return Number(this.db.prepare('DELETE FROM buffer WHERE ts < ?').run(now - BUFFER_DAYS * DAY).changes);
  }

  // ---- devices ---------------------------------------------------------------------------------

  devices<T>(): T[] {
    return (this.db.prepare('SELECT json FROM devices ORDER BY id').all() as { json: string }[]).map((r) => JSON.parse(r.json) as T);
  }

  saveDevice(id: string, device: unknown): void {
    this.db.prepare('INSERT INTO devices (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(id, JSON.stringify(device));
  }

  // ---- reverts ---------------------------------------------------------------------------------

  setRevert(r: PendingRevert): void {
    this.db
      .prepare('INSERT INTO reverts (key, device, action, at, undo) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, undo = reverts.undo')
      .run(r.key, r.deviceId, r.action, r.at, JSON.stringify(r.undo));
  }

  reverts(): PendingRevert[] {
    const rows = this.db.prepare('SELECT key, device, action, at, undo FROM reverts ORDER BY at').all() as { key: string; device: string; action: string; at: number; undo: string }[];
    return rows.map((r) => ({ key: r.key, deviceId: r.device, action: r.action, at: r.at, undo: JSON.parse(r.undo) }));
  }

  dropRevert(key: string): void {
    this.db.prepare('DELETE FROM reverts WHERE key = ?').run(key);
  }

  // ---- settings --------------------------------------------------------------------------------

  get<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}
