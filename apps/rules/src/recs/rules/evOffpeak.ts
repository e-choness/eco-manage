import { bucketOf, dedupeKeyOf, periodAt, type Check, type Proposal, type RuleParams } from '@ecomanage/shared';
import type { Action, EvSession, RecContext, Rule } from '../types';
import { HOUR_MS, STEP_MS, hhmm, money, nextLocalTime, perKwh, rateAt, round1 } from '../util';

// EV off-peak (plan §5): a session charging in mid or peak hours whose vehicle (a fleet vehicle,
// unless fleetOnly is off) has time to take its usual energy in the cheapest hours before it
// leaves: pause it now and charge at full current from the cheap period until departure.
//   saving = energy that would have gone in at today's rate × (rate now − cheap rate)

type P = RuleParams<'ev-offpeak'>;

const ID = 'ev-offpeak' as const;
const MAX_A = 32; // the chargers' profile limit (ocpp16-generic)
const DEFAULT_CHARGER_KW = 22;

interface Plan {
  session: EvSession;
  departure: Date;
  needKwh: number;
  cheapStart: Date;
  rateNow: number;
  rateCheap: number;
  chargerKw: number;
}

/** When the vehicle leaves, what it still needs, and when the cheapest price before then starts. */
const plan = (ctx: RecContext, s: EvSession): Plan | null => {
  const t = ctx.tariff;
  if (!t || !s.vehicle) return null;
  const departure = nextLocalTime(ctx.now, s.vehicle.departure, ctx.site.tz);
  const usual = s.typicalKwh ?? s.vehicle.capacityKwh;
  if (usual === null) return null;
  const needKwh = round1(Math.max(0, usual - s.deliveredKwh));
  let cheapStart: Date | null = null;
  let rateCheap = Infinity;
  for (let ms = ctx.now.getTime(); ms < departure.getTime(); ms += STEP_MS) {
    const r = rateAt(t, new Date(ms), ctx.site.tz);
    if (r < rateCheap) [rateCheap, cheapStart] = [r, new Date(ms)];
  }
  if (!cheapStart) return null;
  return { session: s, departure, needKwh, cheapStart, rateNow: rateAt(t, ctx.now, ctx.site.tz), rateCheap, chargerKw: s.ratedKw ?? DEFAULT_CHARGER_KW };
};

const planFor = (ctx: RecContext, action: Action) => {
  const s = ctx.evSessions.find((x) => x.deviceId === action.deviceId);
  return s ? plan(ctx, s) : null;
};

export const evOffpeak: Rule<P> = {
  id: ID,

  evaluate(ctx, p) {
    if (!ctx.tariff) return null;
    const bucket = bucketOf(periodAt(ctx.tariff, ctx.now, ctx.site.tz).name);
    if (bucket === 'op') return null; // already cheap
    const tz = ctx.site.tz;
    const out: Proposal[] = [];
    for (const s of ctx.evSessions) {
      if (s.chargingKw < 1) continue;
      if (p.fleetOnly && !s.vehicle) continue;
      const x = plan(ctx, s);
      if (!x || x.needKwh < 1 || x.rateCheap >= x.rateNow) continue;
      if (x.cheapStart.getTime() - ctx.now.getTime() < 30 * 60_000) continue; // cheap soon anyway
      const hoursAvailable = (x.departure.getTime() - x.cheapStart.getTime()) / HOUR_MS;
      if (x.needKwh * (1 + p.bufferPct / 100) > x.chargerKw * hoursAvailable) continue; // wouldn't fit
      const window = { start: x.cheapStart, end: x.departure };
      out.push({
        deviceId: s.deviceId,
        action: 'set_charging_profile',
        params: {
          schedule: [
            { start: ctx.now.toISOString(), limitA: 0 },
            { start: x.cheapStart.toISOString(), limitA: MAX_A },
          ],
          validTo: x.departure.toISOString(),
        },
        window,
        title: `Move ${s.vehicle!.name} charging to ${hhmm(x.cheapStart, tz)}`,
        dedupeKey: dedupeKeyOf(ID, s.deviceId, { start: s.startedAt, end: x.departure }),
        // Worth deciding until the cheap period starts.
        expiresAt: new Date(x.cheapStart.getTime() - ctx.approval.expireMin * 60_000),
        inputs: [
          { label: 'Session', value: `${s.chargerName} · ${s.vehicle!.name}${s.idTag ? ` (RFID ${s.idTag})` : ''}` },
          { label: 'Fleet profile', value: `leaves ${s.vehicle!.departure}` },
          {
            label: 'Energy needed',
            value: s.typicalKwh !== null ? `≈ ${x.needKwh} kWh (average of last ${s.typicalFrom} sessions, ${round1(s.deliveredKwh)} kWh in so far)` : `≈ ${x.needKwh} kWh (battery capacity)`,
          },
          { label: 'Off-peak window', value: `${hhmm(x.cheapStart, tz)}–${hhmm(x.departure, tz)} · ${x.chargerKw} kW available` },
          { label: 'Tariff', value: `now ${perKwh(x.rateNow)} until ${hhmm(x.cheapStart, tz)}, then ${perKwh(x.rateCheap)}` },
        ],
      });
    }
    return out;
  },

  check(ctx, action, p): Check[] {
    const x = planFor(ctx, action);
    if (!x) return [{ text: 'The charging session is still running', pass: false }];
    const tz = ctx.site.tz;
    const finish = new Date(x.cheapStart.getTime() + (x.needKwh / x.chargerKw) * HOUR_MS);
    const withBuffer = x.needKwh * (1 + p.bufferPct / 100);
    const room = (x.chargerKw * (x.departure.getTime() - x.cheapStart.getTime())) / HOUR_MS;
    return [
      { text: `Finishes by ${hhmm(finish, tz)}, before the ${hhmm(x.departure, tz)} departure`, pass: finish <= x.departure },
      { text: `Keeps a ${p.bufferPct}% energy buffer`, pass: withBuffer <= room },
      { text: 'Fleet vehicle', pass: !!x.session.vehicle },
    ];
  },

  saving(ctx, action) {
    const x = planFor(ctx, action);
    if (!x) return { cents: 0, calc: 'session ended' };
    // Without the change it keeps charging at its current power until it has what it needs.
    const hoursAtRateNow = (x.cheapStart.getTime() - ctx.now.getTime()) / HOUR_MS;
    const shifted = round1(Math.min(x.needKwh, Math.max(x.session.chargingKw, 1) * hoursAtRateNow));
    const cents = Math.round(shifted * (x.rateNow - x.rateCheap));
    return { cents, calc: `${shifted} kWh × (${perKwh(x.rateNow)} − ${perKwh(x.rateCheap)}) = ${money(cents)}` };
  },
};
