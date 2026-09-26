import { dedupeKeyOf, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, RecContext, Rule } from '../types';
import { STEP_MS, hhmm, money, round1 } from '../util';

// EV limit near cap (plan §5): the 15-minute demand projection is within `withinPct` of the cap
// while EVs charge: limit the busiest charger to what keeps demand under the cap (never below
// `minA`) for this interval and the next. It acts now, so it must be decided within the quarter.

type P = RuleParams<'ev-limit-near-cap'>;

const ID = 'ev-limit-near-cap' as const;
const VOLTS = 230;
const PHASES = 3;
const MAX_A = 32;
const DECIDE_WITHIN_MS = 10 * 60_000;

const kwToA = (kw: number) => (kw * 1000) / (VOLTS * PHASES);
const aToKw = (a: number) => (a * VOLTS * PHASES) / 1000;

/** Demand now and what limiting the charger to `amps` does to it. */
const effect = (ctx: RecContext, action: Action) => {
  const s = ctx.evSessions.find((x) => x.deviceId === action.deviceId);
  const projected = ctx.demand?.projectedKw ?? 0;
  const cut = s ? Math.max(0, s.chargingKw - aToKw(Number(action.params.amps))) : 0;
  return { session: s, projected, after: round1(projected - cut) };
};

export const evLimitNearCap: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    const cap = ctx.site.demandCapKw;
    if (!cap || !ctx.demand) return null;
    if (ctx.now.getTime() - Date.parse(ctx.demand.intervalStart) > STEP_MS) return null; // stale
    const threshold = cap * (1 - p.withinPct / 100);
    if (ctx.demand.projectedKw < threshold) return null;
    const busiest = [...ctx.evSessions].filter((s) => s.chargingKw >= aToKw(p.minA)).sort((a, b) => b.chargingKw - a.chargingKw)[0];
    if (!busiest) return null;

    // Take the whole excess over the threshold from the busiest charger, down to the minimum.
    const excess = ctx.demand.projectedKw - threshold;
    const amps = Math.max(p.minA, Math.min(MAX_A, Math.floor(kwToA(busiest.chargingKw - excess))));
    if (amps >= kwToA(busiest.chargingKw)) return null; // wouldn't lower anything
    const window = { start: ctx.now, end: new Date(ctx.now.getTime() + 2 * STEP_MS) };
    const tz = ctx.site.tz;
    const proposal: Proposal = {
      deviceId: busiest.deviceId,
      action: 'limit_current',
      params: { amps, until: window.end.toISOString() },
      window,
      title: `Limit ${busiest.chargerName} to ${amps} A, ${hhmm(window.start, tz)}–${hhmm(window.end, tz)}`,
      dedupeKey: dedupeKeyOf(ID, busiest.deviceId, window),
      expiresAt: new Date(ctx.now.getTime() + DECIDE_WITHIN_MS),
      inputs: [
        { label: '15-min demand projection', value: `${Math.round(ctx.demand.projectedKw)} kW` },
        { label: 'Cap', value: `${cap} kW (acts from ${Math.round(threshold)} kW)` },
        { label: 'Charging now', value: ctx.evSessions.filter((s) => s.chargingKw >= 1).map((s) => `${s.chargerName} ${round1(s.chargingKw)} kW`).join(', ') },
      ],
    };
    return proposal;
  },

  check(ctx, action, p): Check[] {
    const cap = ctx.site.demandCapKw!;
    const amps = Number(action.params.amps);
    const { session, after } = effect(ctx, action);
    return [
      { text: 'The charger is still charging', pass: !!session && session.chargingKw >= 1 },
      { text: `At least the ${p.minA} A minimum per charger`, pass: amps >= p.minA },
      { text: `Projected demand ${Math.round(after)} kW stays under the ${cap} kW cap`, pass: after <= cap },
    ];
  },

  saving(ctx, action) {
    const rate = ctx.tariff?.demandRateCents ?? 0;
    const { projected, after } = effect(ctx, action);
    const month = round1(ctx.period.peakKw);
    if (projected <= month) return { cents: 0, calc: `keeps demand under the cap; this month's peak ${month} kW is higher than ${Math.round(projected)} kW` };
    const kw = round1(projected - Math.max(month, after));
    const cents = Math.round(kw * rate);
    return { cents, calc: `${Math.round(projected)} kW − ${Math.round(Math.max(month, after))} kW = ${kw} kW × ${money(rate)}/kW = ${money(cents)}` };
  },
};
