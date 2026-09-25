/**
 * P3-02: the six App v2 rules on hand-made site states: each triggers, stays quiet when it should,
 * and reports a failing check; inputs and calc read like App v2.
 *
 * Maple Grove on Thu 24 Sep 2026 (EDT, UTC−4), commercial TOU-D: peak 14:00–20:00 at 27¢, mid
 * 07:00–14:00 and 20:00–24:00 at 16¢, off-peak 00:00–07:00 at 9¢; demand $14/kW; cap 120 kW.
 */
import { describe, expect, it } from 'vitest'
import { RULE_DEFAULTS, TARIFF_TEMPLATES, type Proposal, type Tariff } from '@ecomanage/shared'
import { evLimitNearCap } from '../recs/rules/evLimitNearCap'
import { evOffpeak } from '../recs/rules/evOffpeak'
import { hpPrecondition } from '../recs/rules/hpPrecondition'
import { peakShaving } from '../recs/rules/peakShaving'
import { stormReserve } from '../recs/rules/stormReserve'
import { zeroExportLowPrice } from '../recs/rules/zeroExportLowPrice'
import type { DeviceCtx, EvSession, ForecastStep, RecContext } from '../recs/types'

const u = (iso: string) => new Date(iso)
const Q = 15 * 60_000
const tariff = { ...TARIFF_TEMPLATES[0].tariff, version: 1, validFrom: '2026-01-01' } as Tariff
const params = <R extends keyof typeof RULE_DEFAULTS>(id: R) => ({ ...RULE_DEFAULTS[id].params }) as never

const device = (id: string, type: string, extra: Partial<DeviceCtx> = {}): DeviceCtx => ({
  id,
  name: id,
  type,
  profileId: null,
  status: 'live',
  ratedKw: null,
  capacityKwh: null,
  latest: null,
  ...extra,
})

/** 24 h of forecast from `from`: net 100 kW unless `over` says otherwise. */
const forecast = (from: Date, over: (ts: Date) => Partial<ForecastStep> = () => ({})): ForecastStep[] =>
  Array.from({ length: 96 }, (_, i) => {
    const ts = new Date(from.getTime() + i * Q)
    const s = { ts, pvKw: 10, loadKw: 110, tempC: 22, storm: false, ...over(ts) }
    return { ...s, netKw: s.loadKw! - s.pvKw! } as ForecastStep
  })

const ctx = (now: Date, over: Partial<RecContext> = {}): RecContext => ({
  now,
  site: { id: 's', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120 },
  today: '2026-09-24',
  dayClass: 'open',
  calendar: null,
  tariff,
  period: { start: u('2026-09-01T04:00:00Z'), end: u('2026-10-01T04:00:00Z'), peakKw: 112, peakAt: u('2026-09-09T19:15:00Z') },
  demand: { intervalStart: now.toISOString(), soFarKw: 88, projectedKw: 90 },
  devices: [
    device('bat', 'battery', { name: 'Battery', ratedKw: 60, capacityKwh: 200 }),
    device('hp', 'heatpump', { name: 'Heat pump', latest: { ts: now.toISOString(), p_kw: -18, sg_mode: 2, q: 'ok' } }),
    device('invA', 'pv', { name: 'Inverter A', ratedKw: 50 }),
    device('invB', 'pv', { name: 'Inverter B', ratedKw: 40 }),
  ],
  battery: { deviceId: 'bat', socPct: 68, reservePct: 20, usableKwh: 200, maxKw: 60, floorPct: 10 },
  forecast: forecast(now),
  commands: [],
  evSessions: [],
  approval: { who: 'owner-or-manager', expireMin: 15, email: 'approvers' },
  ...over,
})

const one = (r: Proposal | Proposal[] | null): Proposal => {
  const list = r === null ? [] : Array.isArray(r) ? r : [r]
  expect(list).toHaveLength(1)
  return list[0]
}

// ---- peak shaving -----------------------------------------------------------------------------------

describe('peak-shaving', () => {
  const noon = u('2026-09-24T16:30:00Z') // 12:30
  // 14:00–17:00 over 110 kW, peaking at 131 kW at 15:15 (load 148, solar 17, 24 °C)
  const peaky = forecast(noon, (ts) => {
    if (ts.getTime() === u('2026-09-24T19:15:00Z').getTime()) return { loadKw: 148, pvKw: 17, tempC: 24 }
    if (ts >= u('2026-09-24T18:00:00Z') && ts < u('2026-09-24T21:00:00Z')) return { loadKw: 125, pvKw: 10 }
    return {}
  })

  it('discharges through the steps over the cap less the margin (App v2 r1)', () => {
    const c = ctx(noon, { forecast: peaky })
    const p = one(peakShaving.evaluate(c, params('peak-shaving')))
    expect(p).toMatchObject({
      deviceId: 'bat',
      action: 'force_discharge',
      params: { kw: 25, until: '2026-09-24T21:00:00.000Z' }, // 5 × ⌈(131 − 120) / 5⌉ + 10 margin
      window: { start: u('2026-09-24T18:00:00Z'), end: u('2026-09-24T21:00:00Z') },
      title: 'Discharge battery at 25 kW, 14:00–17:00',
    })
    expect(p.inputs).toEqual([
      { label: 'Current 15-min demand', value: '88 kW' },
      { label: 'Month peak so far', value: '112 kW · 9 Sept 15:15' },
      { label: 'Load forecast 14:00–20:00', value: 'max 148 kW at 15:15 (open day, 24 °C)' },
      { label: 'Solar forecast at 15:15', value: '17 kW' },
      { label: 'Net peak forecast', value: '131 kW' },
      { label: 'Battery now', value: '68%' },
      { label: 'Tariff', value: 'peak 14:00–20:00 · $14/kW demand' },
    ])
    expect(peakShaving.check(c, p, params('peak-shaving'))).toEqual([
      { text: 'Battery stays at or above 30% on open days: ends at 31%', pass: true }, // 68 − 25 × 3 h / 200 kWh
      { text: 'Within the 60 kW discharge limit', pass: true },
      { text: 'Projected peak 106 kW stays under the 120 kW cap', pass: true },
    ])
    expect(peakShaving.saving(c, p, params('peak-shaving'))).toEqual({ cents: 26_600, calc: 'new peak 131 kW − current month peak 112 kW = 19 kW × $14/kW = $266' })
  })

  it('keeps the same dedupeKey while the forecast moves within the same peak period', () => {
    const a = one(peakShaving.evaluate(ctx(noon, { forecast: peaky }), params('peak-shaving')))
    const later = u('2026-09-24T16:45:00Z')
    const b = one(peakShaving.evaluate(ctx(later, { forecast: peaky.filter((s) => s.ts >= later).map((s) => (s.netKw === 131 ? { ...s, netKw: 136, loadKw: 153 } : s)) }), params('peak-shaving')))
    expect(b.dedupeKey).toBe(a.dedupeKey)
    expect(b.params.kw).toBe(30)
  })

  it('stays quiet while the forecast stays under the cap less the margin', () => {
    expect(peakShaving.evaluate(ctx(noon), params('peak-shaving'))).toBeNull() // net 100
  })

  it('fails the state-of-charge check when the battery is low', () => {
    const c = ctx(noon, { forecast: peaky, battery: { deviceId: 'bat', socPct: 40, reservePct: 20, usableKwh: 200, maxKw: 60, floorPct: 10 } })
    const p = one(peakShaving.evaluate(c, params('peak-shaving')))
    expect(peakShaving.check(c, p, params('peak-shaving'))[0]).toEqual({ text: 'Battery stays at or above 30% on open days: ends at 3%', pass: false })
  })
})

// ---- EV off-peak ---------------------------------------------------------------------------------------

const bus = (over: Partial<EvSession> = {}): EvSession => ({
  deviceId: 'ev1',
  chargerName: 'EV charger 1',
  sessionId: 'sess-1',
  idTag: 'BUS-2',
  deliveredKwh: 5,
  startedAt: u('2026-09-24T19:05:00Z'),
  chargingKw: 22,
  ratedKw: 22,
  vehicle: { name: 'Bus 2', departure: '07:00', capacityKwh: 150 },
  typicalKwh: 47,
  typicalFrom: 10,
  ...over,
})

describe('ev-offpeak', () => {
  const peak = u('2026-09-24T19:15:00Z') // 15:15, peak

  it('moves a fleet bus to the cheapest hours before it leaves (App v2 r2)', () => {
    const c = ctx(peak, { evSessions: [bus()] })
    const p = one(evOffpeak.evaluate(c, params('ev-offpeak')))
    expect(p).toMatchObject({
      deviceId: 'ev1',
      action: 'set_charging_profile',
      params: {
        schedule: [
          { start: '2026-09-24T19:15:00.000Z', limitA: 0 },
          { start: '2026-09-25T04:00:00.000Z', limitA: 32 },
        ],
        validTo: '2026-09-25T11:00:00.000Z',
      },
      title: 'Move Bus 2 charging to 00:00',
      expiresAt: u('2026-09-25T03:45:00Z'),
    })
    expect(p.inputs).toEqual([
      { label: 'Session', value: 'EV charger 1 · Bus 2 (RFID BUS-2)' },
      { label: 'Fleet profile', value: 'leaves 07:00' },
      { label: 'Energy needed', value: '≈ 42 kWh (average of last 10 sessions, 5 kWh in so far)' },
      { label: 'Off-peak window', value: '00:00–07:00 · 22 kW available' },
      { label: 'Tariff', value: 'now $0.27 until 00:00, then $0.09' },
    ])
    expect(evOffpeak.check(c, p, params('ev-offpeak'))).toEqual([
      { text: 'Finishes by 01:54, before the 07:00 departure', pass: true },
      { text: 'Keeps a 20% energy buffer', pass: true },
      { text: 'Fleet vehicle', pass: true },
    ])
    expect(evOffpeak.saving(c, p, params('ev-offpeak'))).toEqual({ cents: 756, calc: '42 kWh × ($0.27 − $0.09) = $7.56' })
  })

  it('proposes one per session, and leaves cars that aren’t fleet vehicles alone', () => {
    const c = ctx(peak, { evSessions: [bus(), bus({ deviceId: 'ev4', sessionId: 's4', idTag: 'BUS-1', vehicle: { name: 'Bus 1', departure: '07:00', capacityKwh: 150 } }), bus({ deviceId: 'ev2', idTag: 'STAFF-11', vehicle: null })] })
    expect((evOffpeak.evaluate(c, params('ev-offpeak')) as Proposal[]).map((p) => p.deviceId)).toEqual(['ev1', 'ev4'])
  })

  it('stays quiet off-peak, when full, or when it wouldn’t fit before departure', () => {
    expect(evOffpeak.evaluate(ctx(u('2026-09-25T06:00:00Z'), { evSessions: [bus()] }), params('ev-offpeak'))).toBeNull() // 02:00, off-peak
    expect(evOffpeak.evaluate(ctx(peak, { evSessions: [bus({ deliveredKwh: 47 })] }), params('ev-offpeak'))).toEqual([])
    expect(evOffpeak.evaluate(ctx(peak, { evSessions: [bus({ vehicle: { name: 'Bus 2', departure: '01:00', capacityKwh: 150 } })] }), params('ev-offpeak'))).toEqual([])
  })

  it('fails its checks at approval if the session has ended', () => {
    const p = one(evOffpeak.evaluate(ctx(peak, { evSessions: [bus()] }), params('ev-offpeak')))
    expect(evOffpeak.check(ctx(peak, { evSessions: [] }), p, params('ev-offpeak'))).toEqual([{ text: 'The charging session is still running', pass: false }])
  })
})

// ---- EV limit near cap ----------------------------------------------------------------------------------

describe('ev-limit-near-cap', () => {
  const q = u('2026-09-24T19:15:00Z')
  const charging = [bus(), bus({ deviceId: 'ev4', chargerName: 'EV charger 4', sessionId: 's4', chargingKw: 11 })]

  it('limits the busiest charger to keep the interval under the cap', () => {
    const c = ctx(q, { demand: { intervalStart: q.toISOString(), soFarKw: 100, projectedKw: 118 }, evSessions: charging })
    const p = one(evLimitNearCap.evaluate(c, params('ev-limit-near-cap')))
    expect(p).toMatchObject({
      deviceId: 'ev1',
      action: 'limit_current',
      params: { amps: 26, until: '2026-09-24T19:45:00.000Z' }, // (22 − (118 − 114)) kW at 230 V × 3
      title: 'Limit EV charger 1 to 26 A, 15:15–15:45',
      expiresAt: u('2026-09-24T19:25:00Z'),
    })
    expect(p.inputs).toEqual([
      { label: '15-min demand projection', value: '118 kW' },
      { label: 'Cap', value: '120 kW (acts from 114 kW)' },
      { label: 'Charging now', value: 'EV charger 1 22 kW, EV charger 4 11 kW' },
    ])
    expect(evLimitNearCap.check(c, p, params('ev-limit-near-cap'))).toEqual([
      { text: 'The charger is still charging', pass: true },
      { text: 'At least the 10 A minimum per charger', pass: true },
      { text: 'Projected demand 114 kW stays under the 120 kW cap', pass: true },
    ])
    expect(evLimitNearCap.saving(c, p, params('ev-limit-near-cap'))).toEqual({ cents: 5740, calc: '118 kW − 114 kW = 4.1 kW × $14/kW = $57.40' })
  })

  it('stays quiet under the threshold or with no EV charging', () => {
    expect(evLimitNearCap.evaluate(ctx(q, { demand: { intervalStart: q.toISOString(), soFarKw: 90, projectedKw: 100 }, evSessions: charging }), params('ev-limit-near-cap'))).toBeNull()
    expect(evLimitNearCap.evaluate(ctx(q, { demand: { intervalStart: q.toISOString(), soFarKw: 100, projectedKw: 118 } }), params('ev-limit-near-cap'))).toBeNull()
  })

  it('fails the cap check when even the minimum current is not enough', () => {
    const c = ctx(q, { demand: { intervalStart: q.toISOString(), soFarKw: 120, projectedKw: 140 }, evSessions: charging })
    const p = one(evLimitNearCap.evaluate(c, params('ev-limit-near-cap')))
    expect(p.params.amps).toBe(10)
    expect(evLimitNearCap.check(c, p, params('ev-limit-near-cap'))[2]).toEqual({ text: 'Projected demand 125 kW stays under the 120 kW cap', pass: false })
  })
})

// ---- heat pump pre-condition ------------------------------------------------------------------------------

describe('hp-precondition', () => {
  const noon = u('2026-09-24T16:30:00Z') // 12:30; peak at 14:00
  const warm = forecast(noon, (ts) => (ts >= u('2026-09-24T18:00:00Z') && ts < u('2026-09-24T20:00:00Z') ? { tempC: 26 } : {}))

  it('boosts before the peak and blocks during it (App v2 r3)', () => {
    const c = ctx(noon, { forecast: warm })
    const p = one(hpPrecondition.evaluate(c, params('hp-precondition')))
    expect(p).toMatchObject({
      deviceId: 'hp',
      action: 'sg_schedule',
      params: {
        schedule: [
          { start: '2026-09-24T17:00:00.000Z', mode: 3 },
          { start: '2026-09-24T18:00:00.000Z', mode: 1 },
          { start: '2026-09-24T20:00:00.000Z', mode: 2 },
        ],
        validTo: '2026-09-24T20:00:00.000Z',
      },
      title: 'Boost 13:00–14:00, then block 14:00–16:00',
    })
    expect(p.inputs).toEqual([
      { label: 'Peak period starts', value: '14:00 (in 1 h 30 min)' },
      { label: 'Outdoor forecast 14:00–16:00', value: '26 °C' },
      { label: 'Heat pump now', value: '18 kW · normal mode' },
      { label: 'Room sensors', value: 'none installed, so time limits are used' },
    ])
    expect(hpPrecondition.check(c, p, params('hp-precondition'))).toEqual([
      { text: 'Boost 60 min, limit 60 min', pass: true },
      { text: 'Block 120 min, limit 120 min', pass: true },
      { text: "Whole schedule within the heat pump's 240 min limit", pass: true },
    ])
    expect(hpPrecondition.saving(c, p, params('hp-precondition'))).toEqual({ cents: 396, calc: '36 kWh × ($0.27 − $0.16) = $3.96' })
  })

  it('adds the demand saving when the block covers a new monthly peak', () => {
    const c = ctx(noon, { forecast: forecast(noon, (ts) => (ts.getTime() === u('2026-09-24T19:15:00Z').getTime() ? { loadKw: 124, pvKw: 10 } : {})) })
    const p = one(hpPrecondition.evaluate(c, params('hp-precondition')))
    expect(hpPrecondition.saving(c, p, params('hp-precondition'))).toEqual({ cents: 396 + 2800, calc: '36 kWh × ($0.27 − $0.16) = $3.96, plus ≈ 2 kW lower peak × $14 = $28 → ≈ $31.96' })
  })

  it('stays quiet when the heat pump is idle, the peak is far off, or it is too late to boost', () => {
    const idle = ctx(noon, { devices: [device('hp', 'heatpump', { latest: { ts: noon.toISOString(), p_kw: -0.2, q: 'ok' } })] })
    expect(hpPrecondition.evaluate(idle, params('hp-precondition'))).toBeNull()
    expect(hpPrecondition.evaluate(ctx(u('2026-09-24T14:30:00Z')), params('hp-precondition'))).toBeNull() // 10:30, peak in 3.5 h
    expect(hpPrecondition.evaluate(ctx(u('2026-09-24T17:15:00Z')), params('hp-precondition'))).toBeNull() // 13:15, boost should have started
  })

  it('fails its checks when a schedule goes past the limits', () => {
    const c = ctx(noon, { forecast: warm })
    const p = one(hpPrecondition.evaluate(c, params('hp-precondition')))
    const longer = { ...p, params: { ...p.params, schedule: [{ start: '2026-09-24T16:30:00.000Z', mode: 3 }, { start: '2026-09-24T18:00:00.000Z', mode: 1 }, { start: '2026-09-24T21:00:00.000Z', mode: 2 }] } }
    expect(hpPrecondition.check(c, longer, params('hp-precondition'))).toEqual([
      { text: 'Boost 90 min, limit 60 min', pass: false },
      { text: 'Block 180 min, limit 120 min', pass: false },
      { text: "Whole schedule within the heat pump's 240 min limit", pass: false },
    ])
  })
})

// ---- storm reserve --------------------------------------------------------------------------------------

describe('storm-reserve', () => {
  const noon = u('2026-09-24T16:30:00Z')
  const stormy = forecast(noon, (ts) => ({ storm: ts >= u('2026-09-24T19:00:00Z') && ts < u('2026-09-24T23:00:00Z') }))

  it('raises the reserve until the warning ends', () => {
    const c = ctx(noon, { forecast: stormy })
    const p = one(stormReserve.evaluate(c, params('storm-reserve')))
    expect(p).toMatchObject({
      deviceId: 'bat',
      action: 'set_reserve',
      params: { pct: 80 },
      window: { start: u('2026-09-24T16:45:00Z'), end: u('2026-09-24T23:00:00Z') },
      title: 'Raise battery reserve to 80% until 19:00',
      expiresAt: u('2026-09-24T19:00:00Z'),
    })
    expect(p.inputs).toEqual([
      { label: 'Weather warning', value: 'thunderstorm 15:00–19:00' },
      { label: 'Battery now', value: '68% · reserve 20%' },
      { label: 'Kept for an outage', value: '160 kWh' },
    ])
    expect(stormReserve.check(c, p, params('storm-reserve'))).toEqual([
      { text: 'Reserve 80% is at least the 10% hardware minimum', pass: true },
      { text: 'Battery can reach 80% before the storm: up to 100%', pass: true },
    ])
    expect(stormReserve.saving(c, p, params('storm-reserve'))).toEqual({ cents: 0, calc: 'no bill saving: keeps 160 kWh for an outage' })
  })

  it('stays quiet without a warning in the lead time, or with the reserve already up', () => {
    expect(stormReserve.evaluate(ctx(noon), params('storm-reserve'))).toBeNull()
    expect(stormReserve.evaluate(ctx(noon, { forecast: stormy }), { reservePct: 80, leadH: 1 } as never)).toBeNull()
    const held = ctx(noon, { forecast: stormy, battery: { deviceId: 'bat', socPct: 90, reservePct: 80, usableKwh: 200, maxKw: 60, floorPct: 10 } })
    expect(stormReserve.evaluate(held, params('storm-reserve'))).toBeNull()
  })

  it('fails the charge check when the battery cannot get there in time', () => {
    const c = ctx(noon, { forecast: stormy, battery: { deviceId: 'bat', socPct: 20, reservePct: 20, usableKwh: 200, maxKw: 10, floorPct: 10 } })
    const p = one(stormReserve.evaluate(c, params('storm-reserve')))
    expect(stormReserve.check(c, p, params('storm-reserve'))[1]).toEqual({ text: 'Battery can reach 80% before the storm: up to 33%', pass: false })
  })
})

// ---- zero export at low prices --------------------------------------------------------------------------

describe('zero-export-low-price', () => {
  const noon = u('2026-09-24T16:30:00Z')
  const negative = { ...tariff, exportRateCents: -2 } as Tariff
  // 13:00–15:00 local: 90 kW of solar against 50 kW of load
  const sunny = forecast(noon, (ts) => (ts >= u('2026-09-24T17:00:00Z') && ts < u('2026-09-24T19:00:00Z') ? { pvKw: 90, loadKw: 50 } : {}))
  const full = { deviceId: 'bat', socPct: 97, reservePct: 20, usableKwh: 200, maxKw: 60, floorPct: 10 }

  it('caps the largest inverter when exporting would cost money and the battery is full', () => {
    const c = ctx(noon, { tariff: negative, forecast: sunny, battery: full })
    const p = one(zeroExportLowPrice.evaluate(c, params('zero-export-low-price')))
    expect(p).toMatchObject({
      deviceId: 'invA',
      action: 'export_limit',
      params: { pct: 20 }, // its 50 of 90 kW, less the 40 kW surplus, of its 50 kW rating
      window: { start: u('2026-09-24T17:00:00Z'), end: u('2026-09-24T19:00:00Z') },
      title: 'Cap Inverter A at 20%, 13:00–15:00',
    })
    expect(p.inputs).toEqual([
      { label: 'Export rate', value: '-2¢/kWh (threshold 0¢)' },
      { label: 'Surplus forecast 13:00–15:00', value: 'up to 40 kW' },
      { label: 'Battery takes', value: 'nothing (full)' },
    ])
    expect(zeroExportLowPrice.check(c, p, params('zero-export-low-price'))).toEqual([
      { text: 'Export rate -2¢/kWh is at or below the 0¢ threshold', pass: true },
      { text: "120 min, within the inverter's 240 min limit", pass: true },
      { text: 'The battery is full, so the surplus is capped', pass: true },
    ])
    expect(zeroExportLowPrice.saving(c, p, params('zero-export-low-price'))).toEqual({ cents: 160, calc: '80 kWh not exported at -2¢/kWh = $1.60' })
  })

  it('stays quiet when exports pay, or the battery can take the surplus', () => {
    expect(zeroExportLowPrice.evaluate(ctx(noon, { forecast: sunny, battery: full }), params('zero-export-low-price'))).toBeNull() // 5¢ > 0¢
    expect(zeroExportLowPrice.evaluate(ctx(noon, { tariff: negative, forecast: sunny }), params('zero-export-low-price'))).toBeNull() // 60 kW ≥ 40 kW
  })

  it('fails the duration check for a window longer than the inverter allows', () => {
    const c = ctx(noon, { tariff: negative, forecast: sunny, battery: full })
    const p = one(zeroExportLowPrice.evaluate(c, params('zero-export-low-price')))
    const long = { ...p, window: { start: p.window.start, end: new Date(p.window.start.getTime() + 5 * 3_600_000) } }
    expect(zeroExportLowPrice.check(c, long, params('zero-export-low-price'))[1]).toEqual({ text: "300 min, within the inverter's 240 min limit", pass: false })
  })
})

describe('determinism', () => {
  it('gives the same proposals for the same state', () => {
    const c = ctx(u('2026-09-24T19:15:00Z'), { evSessions: [bus()] })
    for (const rule of [peakShaving, evOffpeak, evLimitNearCap, hpPrecondition, stormReserve, zeroExportLowPrice])
      expect(JSON.stringify(rule.evaluate(c, params(rule.id)))).toBe(JSON.stringify(rule.evaluate(structuredClone(c), params(rule.id))))
  })
})
