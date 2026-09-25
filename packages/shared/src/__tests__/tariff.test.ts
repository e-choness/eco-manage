import { describe, expect, it } from 'vitest'
import { TARIFF_TEMPLATES, minutesOf, seasonHasMonth, tariffInput, tariffOn, validateTariff, type TariffInput } from '../tariff'

const tou = TARIFF_TEMPLATES[0].tariff
const withPeriods = (periods: TariffInput['periods'], seasons = tou.seasons) => ({ seasons, periods })

describe('templates', () => {
  it('are valid tariffs', () => {
    for (const t of TARIFF_TEMPLATES) {
      expect(tariffInput.safeParse({ ...t.tariff, validFrom: '2026-04-01' }).success).toBe(true)
      expect(validateTariff(t.tariff)).toEqual([])
    }
  })
})

describe('validateTariff', () => {
  it('finds a gap and names the months and day type', () => {
    const periods = tou.periods.filter((p) => !(p.name === 'Peak' && p.season === 'summer'))
    expect(validateTariff(withPeriods(periods))).toEqual([
      { kind: 'gap', days: 'weekday', from: '14:00', to: '20:00', months: 'Apr–Oct', message: 'No rate for 14:00–20:00 (weekdays, Apr–Oct)' },
    ])
  })

  it('finds overlaps and names both periods', () => {
    const periods = [...tou.periods, { name: 'Peak', season: 'all', days: 'weekends' as const, start: '16:00', end: '18:00', rateCents: 27 }]
    expect(validateTariff(withPeriods(periods))).toEqual([
      {
        kind: 'overlap',
        days: 'weekend',
        from: '16:00',
        to: '18:00',
        months: 'Jan–Dec',
        message: 'Off-peak 00:00–00:00 and Peak 16:00–18:00 overlap 16:00–18:00 (weekends, Jan–Dec)',
      },
    ])
  })

  it('treats an end at or before the start as midnight (00:00–00:00 is the whole day)', () => {
    const whole = [{ name: 'Mid', season: 'all', days: 'all' as const, start: '00:00', end: '00:00', rateCents: 15 }]
    expect(validateTariff(withPeriods(whole, []))).toEqual([])
    // Periods don't wrap past midnight: 06:00–06:00 runs to midnight, so 00:00–06:00 is uncovered.
    const fromSix = [{ name: 'Mid', season: 'all', days: 'all' as const, start: '06:00', end: '06:00', rateCents: 15 }]
    expect(validateTariff(withPeriods(fromSix, [])).map((i) => [i.kind, i.from, i.to])).toEqual([
      ['gap', '00:00', '06:00'],
      ['gap', '00:00', '06:00'],
    ])
    const split = [
      { name: 'Day', season: 'all', days: 'all' as const, start: '07:00', end: '00:00', rateCents: 15 },
      { name: 'Night', season: 'all', days: 'all' as const, start: '00:00', end: '07:00', rateCents: 9 },
    ]
    expect(validateTariff(withPeriods(split, []))).toEqual([])
  })

  it('reports unknown seasons and months in two seasons', () => {
    const issues = validateTariff({
      seasons: [
        { id: 'a', name: 'A', fromMonth: 1, toMonth: 6 },
        { id: 'b', name: 'B', fromMonth: 6, toMonth: 12 },
      ],
      periods: [
        { name: 'X', season: 'a', days: 'all', start: '00:00', end: '00:00', rateCents: 1 },
        { name: 'Y', season: 'b', days: 'all', start: '00:00', end: '00:00', rateCents: 1 },
        { name: 'Z', season: 'nope', days: 'all', start: '00:00', end: '00:00', rateCents: 1 },
      ],
    })
    expect(issues.map((i) => i.kind).sort()).toEqual(['overlap', 'overlap', 'season-overlap', 'unknown-season'])
    expect(issues.find((i) => i.kind === 'season-overlap')?.message).toBe('Jun is in more than one season (A, B)')
  })

  it('groups non-adjacent months', () => {
    const periods = [{ name: 'Only summer', season: 'summer', days: 'all' as const, start: '00:00', end: '00:00', rateCents: 1 }]
    const gaps = validateTariff(withPeriods(periods))
    expect(gaps.map((g) => g.months)).toEqual(['Jan–Mar, Nov–Dec', 'Jan–Mar, Nov–Dec'])
  })
})

describe('helpers', () => {
  it('reads HH:mm and wrapping seasons', () => {
    expect(minutesOf('14:30')).toBe(870)
    expect(seasonHasMonth({ fromMonth: 11, toMonth: 3 }, 1)).toBe(true)
    expect(seasonHasMonth({ fromMonth: 11, toMonth: 3 }, 6)).toBe(false)
    expect(seasonHasMonth({ fromMonth: 4, toMonth: 10 }, 10)).toBe(true)
  })

  it('rejects malformed input', () => {
    const base = { ...tou, validFrom: '2026-04-01' }
    expect(tariffInput.safeParse({ ...base, demandIntervalMin: 20 }).success).toBe(false)
    expect(tariffInput.safeParse({ ...base, periods: [{ ...tou.periods[0], start: '7:00' }] }).success).toBe(false)
    expect(tariffInput.safeParse({ ...base, periods: [] }).success).toBe(false)
    expect(tariffInput.safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('tariffOn', () => {
  const v = (version: number, validFrom: string) => ({ version, validFrom })
  const versions = [v(1, '2024-03-14'), v(2, '2025-01-01'), v(3, '2026-04-01'), v(4, '2026-04-01')]

  it('picks the latest version valid on the date, the highest among equal dates', () => {
    expect(tariffOn(versions, '2025-06-30')?.version).toBe(2)
    expect(tariffOn(versions, '2026-04-01')?.version).toBe(4)
    expect(tariffOn(versions, '2026-09-24')?.version).toBe(4)
    expect(tariffOn([v(4, '2026-04-01'), v(3, '2026-04-01')], '2026-09-24')?.version).toBe(4)
  })

  it('returns null before the first version', () => {
    expect(tariffOn(versions, '2024-01-01')).toBeNull()
  })
})
