/**
 * P4-03: Home's price strip. The periods of one local day, minute-exact, with a level for colour.
 */
import { describe, expect, it } from 'vitest'
import { TARIFF_TEMPLATES, dayPrices } from '../tariff'

const TO = 'America/Toronto'
const tou = TARIFF_TEMPLATES[0].tariff
const flat = TARIFF_TEMPLATES[1].tariff
const brief = (date: string, t = tou) => dayPrices(t, date, TO).map((s) => `${s.name} ${s.rateCents} ${s.level} ${s.start}→${s.end}`)

describe('dayPrices', () => {
  it('splits a summer weekday into off-peak, mid, peak and mid (App v2 strip)', () => {
    expect(brief('2026-09-24')).toEqual([
      'Off-peak 9 off 2026-09-24T04:00:00.000Z→2026-09-24T11:00:00.000Z',
      'Mid 16 mid 2026-09-24T11:00:00.000Z→2026-09-24T18:00:00.000Z',
      'Peak 27 peak 2026-09-24T18:00:00.000Z→2026-09-25T00:00:00.000Z',
      'Mid 16 mid 2026-09-25T00:00:00.000Z→2026-09-25T04:00:00.000Z',
    ])
  })

  it('keeps a whole weekend as one off-peak run, and a flat tariff as one mid run', () => {
    expect(brief('2026-09-26')).toEqual(['Off-peak 9 mid 2026-09-26T04:00:00.000Z→2026-09-27T04:00:00.000Z'])
    expect(brief('2026-09-24', flat)).toEqual(['Mid 15 mid 2026-09-24T04:00:00.000Z→2026-09-25T04:00:00.000Z'])
  })

  it('follows a 25-hour DST day and minutes that are not on a quarter hour', () => {
    const t = { ...flat, periods: [
      { name: 'Cheap', season: 'all', days: 'all' as const, start: '00:00', end: '06:10', rateCents: 8 },
      { name: 'Normal', season: 'all', days: 'all' as const, start: '06:10', end: '00:00', rateCents: 15 },
    ] }
    const day = dayPrices(t, '2026-11-01', TO) // clocks go back at 02:00
    expect(day.map((s) => [s.name, s.level, s.start, s.end])).toEqual([
      ['Cheap', 'off', '2026-11-01T04:00:00.000Z', '2026-11-01T11:10:00.000Z'],
      ['Normal', 'peak', '2026-11-01T11:10:00.000Z', '2026-11-02T05:00:00.000Z'],
    ])
  })
})
