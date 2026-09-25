import { z } from 'zod';
import { DEVICE_TYPES, telemetryReading } from '@ecomanage/shared';

// Telemetry fields a profile may declare: the standard field set minus ts and q, which every
// reading carries.
export const TELEMETRY_FIELDS = Object.keys(telemetryReading.shape).filter((f) => f !== 'ts' && f !== 'q') as [
  string,
  ...string[],
];

const field = z.enum(TELEMETRY_FIELDS);

// Where a field comes from: a Modbus register (with an optional scale-factor register), or a
// named value in a protocol message (OCPP MeterValues, SG-Ready relay state …).
const source = z.union([
  z
    .object({
      field,
      reg: z.number().int().nonnegative(),
      type: z.enum(['int16', 'uint16', 'int32', 'uint32', 'acc32', 'acc64', 'float32', 'bitfield16', 'bitfield32', 'enum16']),
      scaleReg: z.number().int().nonnegative().optional(),
      mult: z.number().optional(),
    })
    .strict(),
  z.object({ field, message: z.string(), measurand: z.string().optional(), mult: z.number().optional() }).strict(),
]);

// A write action and its hard limits. The gateway enforces the limits; the rules service and the
// API check them before proposing or approving (plan §0.9, spec §4 safety limits).
const writeAction = z
  .object({
    description: z.string(),
    reg: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
    params: z.record(
      z
        .object({
          type: z.enum(['number', 'integer', 'boolean', 'time', 'schedule']),
          unit: z.string().optional(),
          min: z.number().optional(),
          max: z.number().optional(),
        })
        .strict()
    ),
    maxDurationMin: z.number().positive().optional(),
    revertReg: z.number().int().nonnegative().optional(),
  })
  .strict();

// A remote fix an alert can offer (Backend Coverage §3: "only fixes listed in the device profile").
const fix = z.object({ id: z.string(), label: z.string(), action: z.string(), params: z.record(z.unknown()).default({}) }).strict();

export const deviceProfile = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+@\d+$/, 'id must look like "name@version"'),
    vendor: z.string(),
    model: z.string(),
    protocol: z.enum(['modbus-tcp', 'modbus-rtu', 'ocpp-1.6j', 'sg-ready', 'mqtt']),
    deviceTypes: z.array(z.enum(DEVICE_TYPES)).min(1),
    fields: z.array(field),
    read: z.array(source),
    write: z.record(writeAction).default({}),
    states: z.record(z.string()).default({}),
    faults: z.record(z.string()).default({}),
    fixes: z.array(fix).default([]),
    pollMs: z.number().int().min(500),
    version: z.number().int().positive(),
    reviewed: z.boolean(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (Number(p.id.split('@')[1]) !== p.version) {
      ctx.addIssue({ code: 'custom', message: `id version and version differ in ${p.id}`, path: ['version'] });
    }
    for (const r of p.read) {
      if (!p.fields.includes(r.field)) ctx.addIssue({ code: 'custom', message: `read maps ${r.field}, which is not in fields`, path: ['read'] });
    }
    for (const f of p.fixes) {
      if (!(f.action in p.write)) ctx.addIssue({ code: 'custom', message: `fix ${f.id} uses unknown action ${f.action}`, path: ['fixes'] });
    }
  });

export type DeviceProfile = z.infer<typeof deviceProfile>;
export type WriteAction = DeviceProfile['write'][string];
