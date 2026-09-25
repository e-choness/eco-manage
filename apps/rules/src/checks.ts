import {
  ALERT_LIMITS as L,
  alertKey,
  type CheckResult,
  type DemandNow,
  type Finding,
  type TelemetryReading,
} from '@ecomanage/shared';

// Alert checks (plan P2-07). Each is a pure function of the site's current state, so the same
// input always gives the same findings; the rules service loads the state and reconciles alerts.

export interface DeviceState {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSeenAt: Date | null;
  latest: TelemetryReading | null;
}

export interface CommandState {
  id: string;
  deviceId: string;
  action: string;
  status: string;
  sentAt: Date | null;
  failedAt: Date | null;
  error: string | null;
}

export interface GatewayState {
  buffered: number;
  oldestBufferedTs: string | null;
  receivedAt: string;
}

export interface SiteContext {
  now: Date;
  demandCapKw: number | null;
  devices: DeviceState[];
  gateway: GatewayState | null;
  demand: DemandNow | null;
  commands: CommandState[];
  /** Per inverter: its output ÷ expected, one value per 5-minute daylight bucket, oldest first. */
  pvRatios: Map<string, number[]>;
  /** Alert keys that are open or acked right now, for checks with hysteresis. */
  active: Set<string>;
}

const FRESH_MS = 2 * 60_000;
const minutes = (ms: number) => Math.round(ms / 60_000);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const result = (): CheckResult => ({ findings: [], evaluated: [] });
const add = (r: CheckResult, f: Finding) => r.findings.push(f);

/** A device that reported before and has been silent for over 5 minutes. */
export const deviceSilent = (ctx: SiteContext): CheckResult => {
  const r = result();
  for (const d of ctx.devices) {
    if (d.type === 'gateway' || d.status === 'pending' || !d.lastSeenAt) continue;
    r.evaluated.push(alertKey('device-silent', d.id));
    const silentMs = ctx.now.getTime() - d.lastSeenAt.getTime();
    if (silentMs > L.silentMs) add(r, { ruleId: 'device-silent', deviceId: d.id, detail: `${d.name}: no data for ${minutes(silentMs)} min` });
  }
  return r;
};

/**
 * Solar below 90% of expected for 2 h of daylight. Opens when the last 24 daylight buckets are all
 * low; once open, it closes only after 1 h of daylight within 5% of expected (Backend Coverage §3).
 */
export const pvUnderperform = (ctx: SiteContext): CheckResult => {
  const r = result();
  for (const [deviceId, ratios] of ctx.pvRatios) {
    const key = alertKey('pv-underperform', deviceId);
    const wasActive = ctx.active.has(key);
    if (ratios.length < (wasActive ? L.pvClearBuckets : L.pvDaylightBuckets)) continue; // night or too little data
    r.evaluated.push(key);
    const opens = ratios.length >= L.pvDaylightBuckets && ratios.slice(-L.pvDaylightBuckets).every((x) => x < L.pvRatio);
    const recovered = ratios.slice(-L.pvClearBuckets).every((x) => x >= L.pvClearRatio);
    if (opens || (wasActive && !recovered)) {
      const recent = ratios.slice(-L.pvClearBuckets);
      const name = ctx.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
      add(r, { ruleId: 'pv-underperform', deviceId, detail: `${name} at ${pct(recent.reduce((s, x) => s + x, 0) / recent.length)} of expected` });
    }
  }
  return r;
};

/** Battery state of charge under its reserve (from a reading at most 2 minutes old). */
export const batteryBelowReserve = (ctx: SiteContext): CheckResult => {
  const r = result();
  for (const d of ctx.devices) {
    if (d.type !== 'battery' || !d.latest || !d.lastSeenAt || ctx.now.getTime() - d.lastSeenAt.getTime() > FRESH_MS) continue;
    const { soc_pct: soc, reserve_pct: reserve } = d.latest;
    if (soc === undefined || reserve === undefined) continue;
    const key = alertKey('battery-below-reserve', d.id);
    r.evaluated.push(key);
    // Half a point of slack: a battery holding at its reserve reads a little either side.
    if (soc < reserve - 0.5 || (ctx.active.has(key) && soc < reserve))
      add(r, { ruleId: 'battery-below-reserve', deviceId: d.id, detail: `${d.name} at ${soc.toFixed(0)}%, reserve ${reserve.toFixed(0)}%` });
  }
  return r;
};

/** This 15-minute interval heading for 90% of the demand cap or more (closes under 85%). */
export const demandNearCap = (ctx: SiteContext): CheckResult => {
  const r = result();
  const cap = ctx.demandCapKw;
  if (!cap || !ctx.demand) return r;
  // A demand figure from an interval that has ended says nothing about now.
  if (ctx.now.getTime() - Date.parse(ctx.demand.intervalStart) > 15 * 60_000) return r;
  const key = alertKey('demand-near-cap', null);
  r.evaluated.push(key);
  const share = ctx.demand.projectedKw / cap;
  if (share >= L.demandCapShare || (ctx.active.has(key) && share >= L.demandClearShare))
    add(r, { ruleId: 'demand-near-cap', deviceId: null, detail: `Heading for ${Math.round(ctx.demand.projectedKw)} kW this interval, cap ${cap} kW (${pct(share)})` });
  return r;
};

/** A command sent more than 30 s ago with no acknowledgement. One alert per device. */
export const commandAckSlow = (ctx: SiteContext): CheckResult => {
  const r = result();
  for (const d of ctx.devices) r.evaluated.push(alertKey('command-ack-slow', d.id));
  const late = new Map<string, CommandState[]>();
  for (const c of ctx.commands)
    if (c.status === 'sent' && c.sentAt && ctx.now.getTime() - c.sentAt.getTime() > L.commandAckMs) late.set(c.deviceId, [...(late.get(c.deviceId) ?? []), c]);
  for (const [deviceId, cmds] of late) {
    const oldest = Math.min(...cmds.map((c) => c.sentAt!.getTime()));
    const name = ctx.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
    add(r, { ruleId: 'command-ack-slow', deviceId, detail: `${name}: ${cmds[0].action} sent ${Math.round((ctx.now.getTime() - oldest) / 1000)} s ago, no answer` });
  }
  return r;
};

/** Each failed command in the last 24 h (an event: it stays open until someone resolves it). */
export const commandFailed = (ctx: SiteContext): CheckResult => {
  const r = result();
  for (const c of ctx.commands) {
    if (c.status !== 'failed' || !c.failedAt || ctx.now.getTime() - c.failedAt.getTime() > L.commandFailedWindowMs) continue;
    const name = ctx.devices.find((d) => d.id === c.deviceId)?.name ?? c.deviceId;
    add(r, { ruleId: 'command-failed', deviceId: c.deviceId, detail: `${name}: ${c.action} failed${c.error ? ` (${c.error})` : ''}`, eventKey: c.id });
  }
  return r;
};

/** The gateway reports buffered readings older than an hour (it was cut off and is catching up). */
export const gatewayBuffer = (ctx: SiteContext): CheckResult => {
  const r = result();
  const gw = ctx.gateway;
  if (!gw) return r;
  r.evaluated.push(alertKey('gateway-buffer', null));
  const ageMs = gw.oldestBufferedTs ? ctx.now.getTime() - Date.parse(gw.oldestBufferedTs) : 0;
  if (gw.buffered > 0 && ageMs > L.gatewayBufferMs)
    add(r, { ruleId: 'gateway-buffer', deviceId: null, detail: `${gw.buffered} readings waiting, oldest from ${minutes(ageMs)} min ago` });
  return r;
};

export const CHECKS = [deviceSilent, pvUnderperform, batteryBelowReserve, demandNearCap, commandAckSlow, commandFailed, gatewayBuffer];

export const runChecks = (ctx: SiteContext): CheckResult => {
  const all = result();
  for (const check of CHECKS) {
    const r = check(ctx);
    all.findings.push(...r.findings);
    all.evaluated.push(...r.evaluated);
  }
  return all;
};
