import { dedupeKeyOf, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, RecContext, Rule } from '../types';
import { STEP_MS, hhmm, money, round1, stepsIn } from '../util';

// Zero export at low prices (plan §5): the export rate is at or below the threshold and the
// forecast shows a solar surplus: let the battery take what it can and cap the largest inverter
// so the rest isn't exported, for the surplus hours (at most the inverter's 4 h limit).

type P = RuleParams<'zero-export-low-price'>;

const ID = 'zero-export-low-price' as const;
const MAX_MIN = 240; // export_limit's longest run (sunspec-inverter profile)
const FULL_SOC = 95;

/** The first stretch of surplus (net < 0) from `from`, up to 4 h. */
const surplusAhead = (ctx: RecContext, from: Date) => {
  const steps = ctx.forecast.filter((s) => s.ts >= from && s.netKw !== null);
  const first = steps.findIndex((s) => s.netKw! < 0);
  if (first < 0) return null;
  const run = [];
  for (const s of steps.slice(first)) {
    if (s.netKw! >= 0 || run.length * 15 >= MAX_MIN || (run.length && s.ts.getTime() !== run.at(-1)!.ts.getTime() + STEP_MS)) break;
    run.push(s);
  }
  return { steps: run, start: run[0].ts, end: new Date(run.at(-1)!.ts.getTime() + STEP_MS) };
};

/** What the battery can absorb, and how much export is left over at the worst step. */
const effect = (ctx: RecContext, window: { start: Date; end: Date }) => {
  const steps = stepsIn(ctx, window.start, window.end).filter((s) => s.netKw !== null);
  const b = ctx.battery;
  const batteryKw = b && (b.socPct ?? 100) < FULL_SOC ? (b.maxKw ?? 0) : 0;
  const worst = Math.max(0, ...steps.map((s) => -s.netKw!));
  const excessKw = Math.max(0, worst - batteryKw);
  const exportedKwh = round1(steps.reduce((a, s) => a + Math.max(0, -s.netKw! - batteryKw) / 4, 0));
  return { batteryKw, worst, excessKw, exportedKwh, steps };
};

export const zeroExportLowPrice: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    const t = ctx.tariff;
    if (!t || t.exportRateCents > p.belowCents) return null;
    const earliest = new Date(ctx.now.getTime() + (ctx.approval.expireMin + 15) * 60_000);
    const surplus = surplusAhead(ctx, earliest);
    if (!surplus) return null;
    const { excessKw, batteryKw, worst } = effect(ctx, surplus);
    if (excessKw <= 0) return null; // the battery takes it all anyway
    const inverter = ctx.devices.filter((d) => d.type === 'pv' && d.ratedKw).sort((a, b) => b.ratedKw! - a.ratedKw!)[0];
    if (!inverter) return null;
    // Output the largest inverter would have at the worst step, less the excess.
    const worstStep = surplus.steps.reduce((m, s) => (s.netKw! < m.netKw! ? s : m));
    const totalRated = ctx.devices.filter((d) => d.type === 'pv').reduce((a, d) => a + (d.ratedKw ?? 0), 0) || inverter.ratedKw!;
    const share = ((worstStep.pvKw ?? 0) * inverter.ratedKw!) / totalRated;
    const pct = Math.max(0, Math.floor(((share - excessKw) / inverter.ratedKw!) * 100));
    const tz = ctx.site.tz;
    const proposal: Proposal = {
      deviceId: inverter.id,
      action: 'export_limit',
      params: { pct },
      window: { start: surplus.start, end: surplus.end },
      title: `Cap ${inverter.name} at ${pct}%, ${hhmm(surplus.start, tz)}–${hhmm(surplus.end, tz)}`,
      dedupeKey: dedupeKeyOf(ID, inverter.id, surplus),
      inputs: [
        { label: 'Export rate', value: `${t.exportRateCents}¢/kWh (threshold ${p.belowCents}¢)` },
        { label: `Surplus forecast ${hhmm(surplus.start, tz)}–${hhmm(surplus.end, tz)}`, value: `up to ${Math.round(worst)} kW` },
        { label: 'Battery takes', value: batteryKw ? `${batteryKw} kW` : 'nothing (full)' },
      ],
    };
    return proposal;
  },

  check(ctx, action, p): Check[] {
    const minutes = (action.window.end.getTime() - action.window.start.getTime()) / 60_000;
    const { batteryKw } = effect(ctx, action.window);
    const rate = ctx.tariff?.exportRateCents ?? Infinity;
    return [
      { text: `Export rate ${rate}¢/kWh is at or below the ${p.belowCents}¢ threshold`, pass: rate <= p.belowCents },
      { text: `${minutes} min, within the inverter's ${MAX_MIN} min limit`, pass: minutes <= MAX_MIN },
      { text: batteryKw ? `The battery takes ${batteryKw} kW of the surplus first` : 'The battery is full, so the surplus is capped', pass: true },
    ];
  },

  saving(ctx, action: Action) {
    const { exportedKwh } = effect(ctx, action.window);
    const rate = ctx.tariff?.exportRateCents ?? 0;
    const cents = Math.round(exportedKwh * Math.max(0, -rate));
    return { cents, calc: rate < 0 ? `${exportedKwh} kWh not exported at ${rate}¢/kWh = ${money(cents)}` : `${exportedKwh} kWh not exported for ${rate}¢/kWh; no bill saving` };
  },
};

