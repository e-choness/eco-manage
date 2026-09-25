/**
 * P2-02: tariff pricing, including property tests across DST changes in America/Toronto and
 * Europe/Berlin (seeded random instants and intervals, so failures reproduce).
 */
import { describe, expect, it } from 'vitest'
import {
  TARIFF_TEMPLATES,
  dayTypeAt,
  demandChargeCents,
  periodAt,
  periodPeak,
  priceAt,
  touSplit,
  type TariffInput,
} from '../tariff'

const tou = TARIFF_TEMPLATES[0].tariff
const TO = 'America/Toronto'
const BE = 'Europe/Berlin'
const u = (iso: string) => new Date(iso)

// Seeded generator (mulberry32) so a failing case can be replayed.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('price at an instant', () => {
  it('follows season, weekday and local time', () => {
    // Thu 24 Sep 2026, Toronto (EDT, UTC-4)
    expect(periodAt(tou, u('2026-09-24T19:15:00Z'), TO).name).toBe('Peak') // 15:15
    expect(priceAt(tou, u('2026-09-24T19:15:00Z'), TO)).toBe(27)
    expect(periodAt(tou, u('2026-09-24T16:40:00Z'), TO).name).toBe('Mid') // 12:40
    expect(periodAt(tou, u('2026-09-24T10:00:00Z'), TO).name).toBe('Off-peak') // 06:00
    expect(periodAt(tou, u('2026-09-25T00:30:00Z'), TO).name).toBe('Mid') // 20:30
    // Winter weekday morning peak, Wed 13 Jan 2027 08:00 EST
    expect(periodAt(tou, u('2027-01-13T13:00:00Z'), TO)).toMatchObject({ name: 'Peak', rateCents: 25 })
    // Saturday afternoon: off-peak all day
    expect(periodAt(tou, u('2026-09-26T19:15:00Z'), TO).name).toBe('Off-peak')
  })

  it('uses the site zone, not UTC, for the day and hour', () => {
    // 02:30Z Saturday is still Friday 22:30 in Toronto: weekday Mid, not weekend Off-peak
    expect(dayTypeAt(u('2026-09-26T02:30:00Z'), TO, tou.holidays)).toBe('weekday')
    expect(periodAt(tou, u('2026-09-26T02:30:00Z'), TO).name).toBe('Mid')
  })

  it('treats holidays as weekends, or as weekdays when the tariff says so', () => {
    const thanksgiving = u('2026-10-12T19:00:00Z') // Monday 15:00 EDT
    const asWeekend: TariffInput['holidays'] = { dates: ['2026-10-12'], treatAs: 'weekend' }
    expect(periodAt({ ...tou, holidays: asWeekend }, thanksgiving, TO).name).toBe('Off-peak')
    expect(periodAt({ ...tou, holidays: { ...asWeekend, treatAs: 'weekday' } }, thanksgiving, TO).name).toBe('Peak')
  })

  it('throws where a tariff has a gap', () => {
    const gappy = { ...tou, periods: tou.periods.filter((p) => p.name !== 'Peak') }
    expect(() => periodAt(gappy, u('2026-09-24T19:15:00Z'), TO)).toThrow(/No tariff period/)
  })
})

describe('TOU split of an interval', () => {
  it('prices a quarter hour inside one period', () => {
    expect(touSplit(tou, u('2026-09-24T19:15:00Z'), u('2026-09-24T19:30:00Z'), 30, TO)).toEqual([{ period: 'Peak', kwh: 30, cents: 810 }])
  })

  it('splits across a period boundary in proportion to time', () => {
    // 13:50–14:10 EDT: 10 minutes Mid (16¢), 10 minutes Peak (27¢)
    const split = touSplit(tou, u('2026-09-24T17:50:00Z'), u('2026-09-24T18:10:00Z'), 20, TO)
    expect(split.map((s) => [s.period, +s.kwh.toFixed(6), +s.cents.toFixed(6)])).toEqual([
      ['Mid', 10, 160],
      ['Peak', 10, 270],
    ])
  })

  it('returns nothing for an empty interval', () => {
    expect(touSplit(tou, u('2026-09-24T19:15:00Z'), u('2026-09-24T19:15:00Z'), 5, TO)).toEqual([])
  })
})

describe('DST changes', () => {
  // Night 00:00–03:00, Day 03:00–midnight, every day: the 03:00 boundary sits right after the
  // missing hour when clocks go forward.
  const nightDay: Pick<TariffInput, 'seasons' | 'periods' | 'holidays'> = {
    seasons: [],
    periods: [
      { name: 'Night', season: 'all', days: 'all', start: '00:00', end: '03:00', rateCents: 8 },
      { name: 'Day', season: 'all', days: 'all', start: '03:00', end: '00:00', rateCents: 20 },
    ],
    holidays: { dates: [], treatAs: 'weekend' },
  }
  const shares = (tz: string, from: string, to: string) =>
    Object.fromEntries(touSplit(nightDay, u(from), u(to), 60, tz).map((s) => [s.period, Math.round(s.kwh)]))

  it('Toronto spring forward: 01:45 EST to 03:15 EDT is 30 real minutes, half night, half day', () => {
    expect(shares(TO, '2026-03-08T06:45:00Z', '2026-03-08T07:15:00Z')).toEqual({ Night: 30, Day: 30 })
  })

  it('Toronto fall back: the repeated 01:00–02:00 hour is night both times', () => {
    expect(shares(TO, '2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z')).toEqual({ Night: 60 })
  })

  it('Berlin spring forward and fall back', () => {
    expect(shares(BE, '2026-03-29T00:45:00Z', '2026-03-29T01:15:00Z')).toEqual({ Night: 30, Day: 30 })
    // 25 Oct 2026: 02:00–03:00 CEST then 02:00–03:00 CET; 03:00 CET is 02:00Z
    expect(shares(BE, '2026-10-25T00:00:00Z', '2026-10-25T02:00:00Z')).toEqual({ Night: 60 })
    expect(shares(BE, '2026-10-25T01:30:00Z', '2026-10-25T02:30:00Z')).toEqual({ Night: 30, Day: 30 })
  })

  it('a whole local day has 23 or 25 hours of energy when clocks change', () => {
    const hours = (tz: string, from: string, to: string) =>
      touSplit(nightDay, u(from), u(to), 1, tz).reduce((s, x) => s + x.kwh, 0) * ((u(to).getTime() - u(from).getTime()) / 3_600_000)
    expect(hours(TO, '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z')).toBeCloseTo(23)
    expect(hours(BE, '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z')).toBeCloseTo(25)
  })
})

describe('properties (seeded, both zones, all of 2026)', () => {
  const zones = [TO, BE]
  const yearStart = Date.parse('2026-01-01T00:00:00Z')
  const yearMs = 365 * 86_400_000

  it('every instant has exactly one period, and the price is that period’s rate', () => {
    const next = rng(42)
    for (let i = 0; i < 3000; i++) {
      const tz = zones[i % 2]
      const at = new Date(yearStart + Math.floor(next() * yearMs))
      const p = periodAt(tou, at, tz)
      expect(tou.periods).toContain(p)
      expect(priceAt(tou, at, tz)).toBe(p.rateCents)
    }
  })

  it('a split keeps all the energy, and its cost is the per-minute sum', () => {
    const next = rng(7)
    for (let i = 0; i < 400; i++) {
      const tz = zones[i % 2]
      const start = new Date(yearStart + Math.floor(next() * yearMs / 60_000) * 60_000)
      const minutes = 1 + Math.floor(next() * 240)
      const end = new Date(start.getTime() + minutes * 60_000)
      const kwh = next() * 100
      const split = touSplit(tou, start, end, kwh, tz)
      expect(split.reduce((s, x) => s + x.kwh, 0)).toBeCloseTo(kwh, 9)
      let expected = 0
      for (let m = 0; m < minutes; m++) expected += (kwh / minutes) * priceAt(tou, new Date(start.getTime() + m * 60_000), tz)
      expect(split.reduce((s, x) => s + x.cents, 0)).toBeCloseTo(expected, 6)
    }
  })

  it('every DST-change interval of 2026 splits without losing energy', () => {
    for (const [tz, instants] of [
      [TO, ['2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z']],
      [BE, ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z']],
    ] as const) {
      for (const iso of instants) {
        for (let offset = -120; offset <= 120; offset += 15) {
          const start = new Date(Date.parse(iso) + offset * 60_000)
          const split = touSplit(tou, start, new Date(start.getTime() + 15 * 60_000), 12.5, tz)
          expect(split.reduce((s, x) => s + x.kwh, 0)).toBeCloseTo(12.5, 9)
        }
      }
    }
  })
})

describe('demand', () => {
  const q = (iso: string, kw: number) => ({ start: u(iso), demandKw: kw })

  it('charges the highest demand of the period at the demand rate, in whole cents', () => {
    expect(demandChargeCents(tou, 112)).toBe(156_800) // 112 kW x $14
    expect(demandChargeCents({ demandRateCents: 1333.3 }, 1.5)).toBe(2000)
    expect(demandChargeCents(tou, -5)).toBe(0)
  })

  it('finds the peak 15-minute interval', () => {
    expect(periodPeak([q('2026-09-09T19:00:00Z', 90), q('2026-09-09T19:15:00Z', 112), q('2026-09-09T19:30:00Z', 70)], 15)).toEqual({
      kw: 112,
      at: u('2026-09-09T19:15:00Z'),
    })
    expect(periodPeak([], 15)).toBeNull()
  })

  it('averages quarter hours into half hours for a 30-minute demand interval', () => {
    const rows = [q('2026-09-09T19:00:00Z', 90), q('2026-09-09T19:15:00Z', 112), q('2026-09-09T19:30:00Z', 100), q('2026-09-09T19:45:00Z', 100)]
    expect(periodPeak(rows, 30)).toEqual({ kw: 101, at: u('2026-09-09T19:00:00Z') })
    expect(periodPeak([q('2026-09-09T19:30:00Z', 80)], 30)).toEqual({ kw: 80, at: u('2026-09-09T19:30:00Z') })
  })
})
