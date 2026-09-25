import { z } from 'zod';

// Topics (plan §3.1). Gateways may only use site/{their siteId}/# (broker ACL).
export const topics = {
  telemetry: (siteId: string, deviceId: string) => `site/${siteId}/dev/${deviceId}/telemetry`,
  deviceStatus: (siteId: string, deviceId: string) => `site/${siteId}/dev/${deviceId}/status`,
  gatewayStatus: (siteId: string) => `site/${siteId}/gw/status`,
  command: (siteId: string, commandId: string) => `site/${siteId}/cmd/${commandId}`,
  commandAck: (siteId: string, commandId: string) => `site/${siteId}/cmd/${commandId}/ack`,
  job: (siteId: string, jobId: string) => `site/${siteId}/job/${jobId}`,
  jobResult: (siteId: string, jobId: string) => `site/${siteId}/job/${jobId}/result`,
} as const;

// Subscription filters for the cloud side.
export const subscriptions = {
  ingest: ['site/+/dev/+/telemetry', 'site/+/dev/+/status', 'site/+/gw/status', 'site/+/cmd/+/ack', 'site/+/job/+/result'],
  gatewayInbox: (siteId: string) => [`site/${siteId}/cmd/+`, `site/${siteId}/job/+`],
} as const;

export type ParsedTopic =
  | { kind: 'telemetry' | 'deviceStatus'; siteId: string; deviceId: string }
  | { kind: 'gatewayStatus'; siteId: string }
  | { kind: 'command' | 'commandAck'; siteId: string; commandId: string }
  | { kind: 'job' | 'jobResult'; siteId: string; jobId: string };

const SEGMENT = /^[A-Za-z0-9_.:-]+$/;

/** Parses a topic back into its parts. Returns null for anything that isn't an EcoManage topic. */
export const parseTopic = (topic: string): ParsedTopic | null => {
  const p = topic.split('/');
  if (p[0] !== 'site' || p.length < 3 || !p.slice(1).every((s) => SEGMENT.test(s))) return null;
  const siteId = p[1];
  if (p[2] === 'dev' && p.length === 5) {
    if (p[4] === 'telemetry') return { kind: 'telemetry', siteId, deviceId: p[3] };
    if (p[4] === 'status') return { kind: 'deviceStatus', siteId, deviceId: p[3] };
    return null;
  }
  if (p[2] === 'gw' && p.length === 4 && p[3] === 'status') return { kind: 'gatewayStatus', siteId };
  if (p[2] === 'cmd' || p[2] === 'job') {
    const id = p[3];
    const isResult = p.length === 5 && p[4] === (p[2] === 'cmd' ? 'ack' : 'result');
    if (p.length === 4 || isResult) {
      if (p[2] === 'cmd') return { kind: isResult ? 'commandAck' : 'command', siteId, commandId: id };
      return { kind: isResult ? 'jobResult' : 'job', siteId, jobId: id };
    }
  }
  return null;
};

// ---- payloads -------------------------------------------------------------------------------

export const QUALITY = ['ok', 'stale', 'estimated', 'backfilled'] as const;
export type Quality = (typeof QUALITY)[number];

const isoTs = z.string().datetime({ offset: true });

/** One reading in the standard field set (Data and Device Audit §3). Unknown fields are rejected. */
export const telemetryReading = z
  .object({
    ts: isoTs,
    p_kw: z.number().finite(),
    e_in_kwh: z.number().finite().nonnegative().optional(),
    e_out_kwh: z.number().finite().nonnegative().optional(),
    soc_pct: z.number().min(0).max(100).optional(),
    soh_pct: z.number().min(0).max(100).optional(),
    reserve_pct: z.number().min(0).max(100).optional(),
    usable_kwh: z.number().nonnegative().optional(),
    state: z.string().max(40).optional(),
    fault: z.array(z.object({ code: z.string(), text: z.string() })).optional(),
    v: z.array(z.number()).max(3).optional(),
    a: z.array(z.number()).max(3).optional(),
    pf: z.number().min(-1).max(1).optional(),
    hz: z.number().positive().optional(),
    dc: z.array(z.object({ v: z.number(), a: z.number() })).optional(),
    t_c: z.number().optional(),
    session: z
      .object({ id: z.string(), idTag: z.string().optional(), kwh: z.number().nonnegative(), startedAt: isoTs })
      .optional(),
    limit_a: z.number().nonnegative().optional(),
    sg_mode: z.number().int().min(1).max(4).optional(),
    supply_c: z.number().optional(),
    return_c: z.number().optional(),
    outdoor_c: z.number().optional(),
    q: z.enum(QUALITY).default('ok'),
  })
  .strict();
export type TelemetryReading = z.infer<typeof telemetryReading>;

/** A telemetry message is one reading or a batch of them (buffered resend). */
export const telemetryMessage = z.union([telemetryReading, z.object({ items: z.array(telemetryReading).min(1).max(5000) })]);
export type TelemetryMessage = z.infer<typeof telemetryMessage>;

export const readingsOf = (msg: TelemetryMessage): TelemetryReading[] => ('items' in msg ? msg.items : [msg]);

export const deviceStatusMessage = z.object({
  ts: isoTs,
  state: z.string(),
  fault: z.array(z.object({ code: z.string(), text: z.string() })).default([]),
});
export type DeviceStatusMessage = z.infer<typeof deviceStatusMessage>;

export const gatewayStatusMessage = z.object({
  ts: isoTs,
  fw: z.string(),
  uptimeS: z.number().nonnegative(),
  buffered: z.number().int().nonnegative(),
  oldestBufferedTs: isoTs.nullable(),
  clockOffsetMs: z.number(),
});
export type GatewayStatusMessage = z.infer<typeof gatewayStatusMessage>;

export const commandMessage = z.object({
  deviceId: z.string(),
  action: z.string(),
  params: z.record(z.unknown()).default({}),
  expiresAt: isoTs,
  revertAt: isoTs.nullable(),
});
export type CommandMessage = z.infer<typeof commandMessage>;

export const commandAckMessage = z.object({ ok: z.boolean(), error: z.string().optional(), ts: isoTs });
export type CommandAckMessage = z.infer<typeof commandAckMessage>;

export const JOB_TYPES = ['scan', 'commission', 'restart'] as const;
export const jobMessage = z.object({ type: z.enum(JOB_TYPES), params: z.record(z.unknown()).default({}) });
export type JobMessage = z.infer<typeof jobMessage>;

export const jobResultMessage = z.object({
  ok: z.boolean(),
  ts: isoTs,
  error: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});
export type JobResultMessage = z.infer<typeof jobResultMessage>;

/** A reading counts as backfilled when it arrives more than this long after its timestamp. */
export const BACKFILL_AFTER_MS = 15 * 60 * 1000;

export const isBackfill = (readingTs: Date, receivedAt: Date): boolean =>
  receivedAt.getTime() - readingTs.getTime() > BACKFILL_AFTER_MS;
