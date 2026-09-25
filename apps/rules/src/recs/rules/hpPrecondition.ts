import { dedupeKeyOf, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, RecContext, Rule } from '../types';
import { HOUR_MS, hhmm, maxBy, money, perKwh, periodSpans, rateAt, round1, stepsIn } from '../util';

// Heat pump pre-condition (plan §5): a peak period starts within 2 h and the heat pump is running:
// SG-Ready boost for up to `boostMin` before the peak, then block for up to `blockMin`, then back to
// normal. Without room sensors, only time limits are used and nothing is claimed about comfort.

type P = RuleParams<'hp-precondition'>;

const ID = 'hp-precondition' as const;
const LOOKAHEAD_MS = 2 * HOUR_MS;
const RUNNING_KW = 1;
const PROFILE_MAX_MIN = 240; // sg_schedule's longest run (sg-ready-heatpump profile)
const MODES: Record<number, string> = { 1: 'blocked', 2: 'normal mode', 3: 'boost', 4: 'forced on' };

type Step = { start: string; mode: number };

const minutesOf = (action: Action) => {
  const s = action.params.schedule as Step[];
  const t = s.map((x) => Date.parse(x.start));
  return { boost: (t[1] - t[0]) / 60_000, block: (t[2] - t[1]) / 60_000 };
};

/** The heat pump's draw, and the energy the block moves out of the peak. */
const effect = (ctx: RecContext, action: Action) => {
  const hp = ctx.devices.find((d) => d.id === action.deviceId);
  const kw = Math.max(0, -(hp?.latest?.p_kw ?? 0));
  const { block } = minutesOf(action);
  return { kw, shiftedKwh: round1((kw * block) / 60) };
};

export const hpPrecondition: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    const hp = ctx.devices.find((d) => d.type === 'heatpump');
    if (!hp || !ctx.tariff) return null;
    const kw = -(hp.latest?.p_kw ?? 0);
    if (kw < RUNNING_KW) return null;
    const span = periodSpans(ctx.tariff, ctx.now, 24, ctx.site.tz).find((s) => s.bucket === 'pk' && s.start > ctx.now);
    if (!span || span.start.getTime() - ctx.now.getTime() > LOOKAHEAD_MS) return null;
    const boostStart = new Date(span.start.getTime() - p.boostMin * 60_000);
    if (boostStart.getTime() - ctx.now.getTime() < ctx.approval.expireMin * 60_000) return null; // too late to boost fully
    const blockEnd = new Date(Math.min(span.end.getTime(), span.start.getTime() + p.blockMin * 60_000));
    const tz = ctx.site.tz;
    const temps = stepsIn(ctx, span.start, blockEnd).map((s) => s.tempC).filter((t): t is number => t !== null);
    const minsToPeak = Math.round((span.start.getTime() - ctx.now.getTime()) / 60_000);
    const proposal: Proposal = {
      deviceId: hp.id,
      action: 'sg_schedule',
      params: {
        schedule: [
          { start: boostStart.toISOString(), mode: 3 },
          { start: span.start.toISOString(), mode: 1 },
          { start: blockEnd.toISOString(), mode: 2 },
        ],
        validTo: blockEnd.toISOString(),
      },
      window: { start: boostStart, end: blockEnd },
      title: `Boost ${hhmm(boostStart, tz)}–${hhmm(span.start, tz)}, then block ${hhmm(span.start, tz)}–${hhmm(blockEnd, tz)}`,
      dedupeKey: dedupeKeyOf(ID, hp.id, span),
      inputs: [
        { label: 'Peak period starts', value: `${hhmm(span.start, tz)} (in ${Math.floor(minsToPeak / 60)} h ${minsToPeak % 60} min)` },
        {
          label: `Outdoor forecast ${hhmm(span.start, tz)}–${hhmm(blockEnd, tz)}`,
          value: temps.length ? `${Math.round(temps.reduce((a, t) => a + t, 0) / temps.length)} °C` : 'no forecast',
        },
        { label: 'Heat pump now', value: `${Math.round(kw)} kW · ${MODES[hp.latest?.sg_mode ?? 2] ?? 'normal mode'}` },
        { label: 'Room sensors', value: 'none installed, so time limits are used' },
      ],
    };
    return proposal;
  },

  check(_ctx, action, p): Check[] {
    const { boost, block } = minutesOf(action);
    return [
      { text: `Boost ${boost} min, limit ${p.boostMin} min`, pass: boost <= p.boostMin },
      { text: `Block ${block} min, limit ${p.blockMin} min`, pass: block <= p.blockMin },
      { text: `Whole schedule within the heat pump's ${PROFILE_MAX_MIN} min limit`, pass: boost + block <= PROFILE_MAX_MIN },
    ];
  },

  saving(ctx, action) {
    const t = ctx.tariff!;
    const s = action.params.schedule as Step[];
    const [boostAt, peakAt, endAt] = s.map((x) => new Date(x.start));
    const peakRate = rateAt(t, peakAt, ctx.site.tz);
    const boostRate = rateAt(t, boostAt, ctx.site.tz);
    const { kw, shiftedKwh } = effect(ctx, action);
    const energyCents = Math.round(shiftedKwh * (peakRate - boostRate));
    let calc = `${shiftedKwh} kWh × (${perKwh(peakRate)} − ${perKwh(boostRate)}) = ${money(energyCents)}`;
    // The block also lowers demand if the site's peak falls in it and would beat this month's.
    const peak = maxBy(stepsIn(ctx, peakAt, endAt), (x) => x.netKw);
    const lower = peak ? round1(Math.max(0, Math.min(kw, peak.value - ctx.period.peakKw))) : 0;
    const demandCents = Math.round(lower * t.demandRateCents);
    if (demandCents > 0) calc += `, plus ≈ ${lower} kW lower peak × ${money(t.demandRateCents)} = ${money(demandCents)} → ≈ ${money(energyCents + demandCents)}`;
    return { cents: energyCents + demandCents, calc };
  },
};
