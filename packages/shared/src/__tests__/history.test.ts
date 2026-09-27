/**
 * P4-05: History ranges, resolutions and buckets (App v2 History).
 */
import { describe, expect, it } from 'vitest'
import { autoRes, barCount, bucketStarts, changePct, compareRange, daysBetween, historyQuery, resolveRange } from '../history'

const TO = 'America/Toronto'
const q = (from: string, to: string, res: 'auto' | '15m' | 'h' | 'd' | 'w' | 'mo' = 'auto') => historyQuery.parse({ from, to, res })

describe('resolution', () => {
  it('picks Auto like App v2', () => {
    expect([1, 2, 3, 92, 93, 400, 401].map(autoRes)).toEqual(['h', 'h', 'd', 'd', 'w', 'w', 'mo'])
  })

  it('counts bars and days', () => {
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(30)
    expect([barCount('15m', 2), barCount('h', 2), barCount('d', 30), barCount('w', 30), barCount('mo', 365)]).toEqual([192, 48, 30, 6, 14])
  })
})

describe('resolveRange', () => {
  it('keeps a range inside the data and swaps a backwards one', () => {
    expect(resolveRange(q('2026-09-30', '2026-09-01'), '2024-03-14', '2026-09-24')).toEqual({
      from: '2026-09-01',
      to: '2026-09-24',
      days: 24,
      res: 'd',
      warnings: ['No data after today.'],
    })
    const early = resolveRange(q('2024-01-01', '2024-03-20', 'd'), '2024-03-14', '2026-09-24')
    expect(early).toMatchObject({ from: '2024-03-14', to: '2024-03-20', days: 7, res: 'd' })
    expect(early.warnings).toEqual(['No data before 14 Mar 2024, when the site started reporting. The range starts there.'])
  })

  it('falls back to the Auto resolution above 400 bars', () => {
    const r = resolveRange(q('2026-01-01', '2026-09-24', '15m'), '2024-03-14', '2026-09-24')
    expect(r.res).toBe('w')
    expect(r.warnings).toEqual(['A 15-min view would draw 25,632 bars, so it shows weekly. CSV export keeps every 15-min interval.'])
  })

  it('never ends up with the start after the end', () => {
    expect(resolveRange(q('2027-01-01', '2027-02-01'), '2024-03-14', '2026-09-24')).toMatchObject({ from: '2026-09-24', to: '2026-09-24', days: 1, res: 'h' })
  })
})

describe('compareRange', () => {
  it('uses the days just before, or the same dates last year', () => {
    expect(compareRange('2026-09-01', '2026-09-30', 'prev')).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(compareRange('2026-09-01', '2026-09-30', 'yoy')).toEqual({ from: '2025-09-01', to: '2025-09-30' })
  })
})

describe('bucketStarts', () => {
  it('starts buckets at local midnight, hours and quarter hours, across DST', () => {
    expect(bucketStarts('2026-09-24', '2026-09-24', 'd', TO)).toEqual(['2026-09-24T04:00:00.000Z'])
    expect(bucketStarts('2026-11-01', '2026-11-01', 'h', TO)).toHaveLength(25) // clocks go back
    expect(bucketStarts('2026-09-24', '2026-09-24', '15m', TO)).toHaveLength(96)
  })

  it('starts weeks on Monday and months on the 1st', () => {
    expect(bucketStarts('2026-09-24', '2026-10-06', 'w', TO)).toEqual(['2026-09-21T04:00:00.000Z', '2026-09-28T04:00:00.000Z', '2026-10-05T04:00:00.000Z'])
    expect(bucketStarts('2026-09-24', '2026-11-02', 'mo', TO)).toEqual(['2026-09-01T04:00:00.000Z', '2026-10-01T04:00:00.000Z', '2026-11-01T04:00:00.000Z'])
  })
})

describe('changePct', () => {
  it('compares, or says there is nothing to compare', () => {
    expect(changePct(112, 100)).toBe(12)
    expect(changePct(90, 100)).toBe(-10)
    expect([changePct(null, 1), changePct(1, null), changePct(1, 0)]).toEqual([null, null, null])
  })
})
