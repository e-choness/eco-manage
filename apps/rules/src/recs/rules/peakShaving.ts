import { dedupeKeyOf, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, RecContext, Rule } from '../types';
import { HOUR_MS, STEP_MS, ceilTo, dayLabel, dayMonthTime, hhmm, maxBy, money, periodSpans, round1, spanAt, stepsIn } from '../util';

// Peak shaving (plan §5): when the forecast net load (load − solar) in the next peak period goes
// over the cap less the margin, discharge the battery through the steps that go over.
//   kW = the smallest multiple of 5 that brings the peak under the cap, plus the margin
//   saving = (forecast peak − max(month peak, new peak)) × demand rate

type P = RuleParams<'peak-shaving'>;

const ID = 'peak-shaving' as const;

/** Forecast peak in the whole tariff period, and the peak once the battery covers the window. */
const effect = (ctx: RecContext, action: Action) => {
  const kw = Number(action.params.kw);
  const span = spanAt(ctx.tariff!, action.window.start, ctx.site.tz);
  const steps = stepsIn(ctx, span.start, span.end).filter((s) => s.netKw !== null);
  const inWindow = (t: Date) => t >= action.window.start && t < action.window.end;
  const before = maxBy(steps, (s) => s.netKw);
  const after = maxBy(steps, (s) => (inWindow(s.ts) ? s.netKw! - kw : s.netKw));
  return { kw, span, before, newPeak: after ? round1(after.value) : 0 };
};

export const peakShaving: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    const cap = ctx.site.demandCapKw;
    const bat = ctx.battery;
    if (!cap || !bat || !ctx.tariff) return null;
    // Leave time to decide and to set the battery up.
    const earliest = new Date(ctx.now.getTime() + (ctx.approval.expireMin + 15) * 60_000);
    const span = periodSpans(ctx.tariff, ctx.now, 24, ctx.site.tz).find((s) => s.bucket === 'pk' && s.end > earliest);
    if (!span) return null;
    const steps = stepsIn(ctx, span.start < earliest ? earliest : span.start, span.end).filter((s) => s.netKw !== null);
    const peak = maxBy(steps, (s) => s.netKw);
    if (!peak || peak.value <= cap - p.marginKw) return null;

    const over = steps.filter((s) => s.netKw! > cap - p.marginKw);
    const window = { start: over[0].ts, end: new Date(over.at(-1)!.ts.getTime() + STEP_MS) };
    const kw = Math.min(p.maxKw, ceilTo(Math.max(0, peak.value - cap), 5) + p.marginKw);
    const tz = ctx.site.tz;
    const at = peak.item;
    const load = maxBy(steps, (s) => s.loadKw);
    const proposal: Proposal = {
      deviceId: bat.deviceId,
      action: 'force_discharge',
      params: { kw, until: window.end.toISOString() },
      window,
      title: `Discharge battery at ${kw} kW, ${hhmm(window.start, tz)}–${hhmm(window.end, tz)}`,
      dedupeKey: dedupeKeyOf(ID, bat.deviceId, span),
      inputs: [
        { label: 'Current 15-min demand', value: ctx.demand ? `${Math.round(ctx.demand.soFarKw)} kW` : 'no reading yet' },
        { label: 'Month peak so far', value: ctx.period.peakAt ? `${round1(ctx.period.peakKw)} kW · ${dayMonthTime(ctx.period.peakAt, tz)}` : 'none yet' },
        {
          label: `Load forecast ${hhmm(span.start, tz)}–${hhmm(span.end, tz)}`,
          value: `max ${Math.round(load?.value ?? 0)} kW at ${hhmm(load?.item.ts ?? at.ts, tz)} (${dayLabel(ctx)}${at.tempC !== null ? `, ${Math.round(at.tempC)} °C` : ''})`,
        },
        { label: `Solar forecast at ${hhmm(at.ts, tz)}`, value: `${Math.round(at.pvKw ?? 0)} kW` },
        { label: 'Net peak forecast', value: `${Math.round(peak.value)} kW` },
        { label: 'Battery now', value: bat.socPct !== null ? `${Math.round(bat.socPct)}%` : 'no reading' },
        { label: 'Tariff', value: `peak ${hhmm(span.start, tz)}–${hhmm(span.end, tz)} · ${money(ctx.tariff.demandRateCents)}/kW demand` },
      ],
    };
    return proposal;
  },

  check(ctx, action, p): Check[] {
    const bat = ctx.battery!;
    const cap = ctx.site.demandCapKw!;
    const { kw, newPeak } = effect(ctx, action);
    const hours = (action.window.end.getTime() - action.window.start.getTime()) / HOUR_MS;
    const minSoc = ctx.dayClass === 'open' ? p.socSchoolPct : p.socOtherPct;
    const endSoc = bat.socPct !== null && bat.usableKwh ? bat.socPct - ((kw * hours) / bat.usableKwh) * 100 : null;
    const limit = Math.min(p.maxKw, bat.maxKw ?? p.maxKw);
    return [
      {
        text: `Battery stays at or above ${minSoc}% on ${dayLabel(ctx)}s: ${endSoc !== null ? `ends at ${Math.round(endSoc)}%` : 'state of charge unknown'}`,
        pass: endSoc !== null && endSoc >= minSoc,
      },
      { text: `Within the ${limit} kW discharge limit`, pass: kw <= limit },
      { text: `Projected peak ${Math.round(newPeak)} kW stays under the ${cap} kW cap`, pass: newPeak <= cap },
    ];
  },

  saving(ctx, action) {
    const rate = ctx.tariff!.demandRateCents;
    const { before, newPeak } = effect(ctx, action);
    const projected = round1(before?.value ?? 0);
    const month = round1(ctx.period.peakKw);
    if (projected <= month) return { cents: 0, calc: `forecast peak ${projected} kW is under this month's peak ${month} kW, so no demand saving` };
    const floor = Math.max(month, newPeak);
    const kw = round1(projected - floor);
    const cents = Math.round(kw * rate);
    const vs = month >= newPeak ? `current month peak ${month} kW` : `${newPeak} kW after discharging`;
    return { cents, calc: `new peak ${projected} kW − ${vs} = ${kw} kW × ${money(rate)}/kW = ${money(cents)}` };
  },
};
