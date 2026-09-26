import { dedupeKeyOf, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, RecContext, Rule } from '../types';
import { HOUR_MS, STEP_MS, hhmm, round1 } from '../util';

// Storm reserve (plan §5): the weather has a severe warning within `leadH` hours: raise the
// battery reserve to `reservePct` from now until the warning ends, so there is energy for an
// outage. It keeps energy back rather than saving money.

type P = RuleParams<'storm-reserve'>;

const ID = 'storm-reserve' as const;

/** The first stretch of storm steps in the forecast from now, within `hours`. */
const stormAhead = (ctx: RecContext, hours: number) => {
  const until = ctx.now.getTime() + hours * HOUR_MS;
  const first = ctx.forecast.find((s) => s.storm && s.ts.getTime() < until);
  if (!first) return null;
  let end = first.ts.getTime() + STEP_MS;
  for (const s of ctx.forecast) if (s.ts.getTime() === end && s.storm) end += STEP_MS;
  return { start: first.ts, end: new Date(end) };
};

const chargeable = (ctx: RecContext, by: Date) => {
  const b = ctx.battery!;
  if (b.socPct === null || !b.usableKwh || !b.maxKw) return null;
  const hours = Math.max(0, (by.getTime() - ctx.now.getTime()) / HOUR_MS);
  return Math.min(100, b.socPct + ((b.maxKw * hours) / b.usableKwh) * 100);
};

export const stormReserve: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    const b = ctx.battery;
    if (!b) return null;
    const storm = stormAhead(ctx, p.leadH);
    if (!storm) return null;
    if ((b.reservePct ?? 0) >= p.reservePct) return null; // already held back
    const tz = ctx.site.tz;
    const window = { start: new Date(ctx.now.getTime() + STEP_MS), end: storm.end };
    const proposal: Proposal = {
      deviceId: b.deviceId,
      action: 'set_reserve',
      params: { pct: p.reservePct },
      window,
      title: `Raise battery reserve to ${p.reservePct}% until ${hhmm(storm.end, tz)}`,
      dedupeKey: dedupeKeyOf(ID, b.deviceId, storm),
      // Worth approving any time before the storm arrives.
      expiresAt: storm.start,
      inputs: [
        { label: 'Weather warning', value: `thunderstorm ${hhmm(storm.start, tz)}–${hhmm(storm.end, tz)}` },
        { label: 'Battery now', value: `${b.socPct !== null ? `${Math.round(b.socPct)}%` : 'no reading'} · reserve ${b.reservePct !== null ? `${Math.round(b.reservePct)}%` : 'unknown'}` },
        { label: 'Kept for an outage', value: b.usableKwh ? `${Math.round((b.usableKwh * p.reservePct) / 100)} kWh` : 'unknown' },
      ],
    };
    return proposal;
  },

  check(ctx, action): Check[] {
    const b = ctx.battery!;
    const pct = Number(action.params.pct);
    const storm = stormAhead(ctx, 48);
    const reach = chargeable(ctx, storm?.start ?? action.window.end);
    return [
      { text: `Reserve ${pct}% is at least the ${b.floorPct}% hardware minimum`, pass: pct >= b.floorPct && pct <= 100 },
      { text: `Battery can reach ${pct}% before the storm${reach !== null ? `: up to ${Math.round(reach)}%` : ''}`, pass: reach !== null && reach >= pct },
    ];
  },

  saving(ctx, action: Action) {
    const kwh = ctx.battery?.usableKwh ? round1((ctx.battery.usableKwh * Number(action.params.pct)) / 100) : 0;
    return { cents: 0, calc: `no bill saving: keeps ${kwh} kWh for an outage` };
  },
};
