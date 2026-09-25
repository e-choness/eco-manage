import { describe, expect, it } from 'vitest'
import {
  billingPeriod,
  endOfSiteDay,
  intervalStart,
  isSiteWeekend,
  isValidZone,
  nextIntervalStart,
  siteClock,
  siteDate,
  siteDateStart,
  siteMinuteOfDay,
  siteWeekday,
  startOfSiteDay,
} from '../time'

const TO = 'America/Toronto'
const BE = 'Europe/Berlin'
const u = (iso: string) => new Date(iso)
const iso = (d: Date) => d.toISOString()

describe('site calendar', () => {
  it('uses the site zone, not UTC, for the date and weekday', () => {
    // 02:30 UTC Saturday is still Friday evening in Toronto
    const at = u('2026-09-26T02:30:00Z')
    expect(siteDate(at, TO)).toBe('2026-09-25')
    expect(siteWeekday(at, TO)).toBe(5)
    expect(isSiteWeekend(at, TO)).toBe(false)
    expect(isSiteWeekend(at, 'UTC')).toBe(true)
    expect(siteMinuteOfDay(at, TO)).toBe(22 * 60 + 30)
    expect(siteClock(at, TO)).toBe('22:30')
  })

  it('validates zones', () => {
    expect(isValidZone(TO)).toBe(true)
    expect(isValidZone('Mars/Olympus')).toBe(false)
    expect(() => siteDate(new Date(), 'Mars/Olympus')).toThrow(RangeError)
    expect(() => siteDateStart('2026-13-40', TO)).toThrow(RangeError)
    expect(() => siteDateStart('2026-09-24', 'Mars/Olympus')).toThrow(RangeError)
  })

  it('finds local midnight', () => {
    expect(iso(siteDateStart('2026-09-24', TO))).toBe('2026-09-24T04:00:00.000Z')
    expect(iso(startOfSiteDay(u('2026-09-24T16:40:00Z'), BE))).toBe('2026-09-23T22:00:00.000Z')
  })
})

describe('DST days', () => {
  it('has a 23 h day when clocks go forward', () => {
    const toronto = u('2026-03-08T12:00:00Z')
    expect(endOfSiteDay(toronto, TO).getTime() - startOfSiteDay(toronto, TO).getTime()).toBe(23 * 3600_000)
    const berlin = u('2026-03-29T12:00:00Z')
    expect(endOfSiteDay(berlin, BE).getTime() - startOfSiteDay(berlin, BE).getTime()).toBe(23 * 3600_000)
  })

  it('has a 25 h day when clocks go back', () => {
    const toronto = u('2026-11-01T12:00:00Z')
    expect(endOfSiteDay(toronto, TO).getTime() - startOfSiteDay(toronto, TO).getTime()).toBe(25 * 3600_000)
    const berlin = u('2026-10-25T12:00:00Z')
    expect(endOfSiteDay(berlin, BE).getTime() - startOfSiteDay(berlin, BE).getTime()).toBe(25 * 3600_000)
  })
})

describe('intervals', () => {
  it('aligns to :00/:15/:30/:45 local time', () => {
    expect(iso(intervalStart(u('2026-09-24T16:44:59.999Z'), TO))).toBe('2026-09-24T16:30:00.000Z')
    expect(iso(intervalStart(u('2026-09-24T16:45:00Z'), TO))).toBe('2026-09-24T16:45:00.000Z')
    expect(iso(intervalStart(u('2026-09-24T16:44:00Z'), TO, 30))).toBe('2026-09-24T16:30:00.000Z')
    expect(iso(nextIntervalStart(u('2026-09-24T16:44:00Z'), TO))).toBe('2026-09-24T16:45:00.000Z')
  })

  it('keeps both occurrences of the repeated hour apart when DST ends', () => {
    // Toronto, 1 Nov 2026: 01:00–02:00 local happens twice (EDT 05:xxZ, then EST 06:xxZ)
    expect(iso(intervalStart(u('2026-11-01T05:40:00Z'), TO))).toBe('2026-11-01T05:30:00.000Z')
    expect(iso(intervalStart(u('2026-11-01T06:40:00Z'), TO))).toBe('2026-11-01T06:30:00.000Z')
  })

  it('aligns to local quarter hours in zones with 45-minute offsets', () => {
    // Nepal is UTC+05:45: local 12:07 is 06:22Z, and its interval starts at local 12:00 = 06:15Z
    expect(iso(intervalStart(u('2026-09-24T06:22:00Z'), 'Asia/Kathmandu'))).toBe('2026-09-24T06:15:00.000Z')
  })
})

describe('billing periods', () => {
  it('runs from the bill day to the same day next month, in site time', () => {
    const p = billingPeriod(u('2026-09-24T16:40:00Z'), TO)
    expect(p.period).toBe('2026-09')
    expect(iso(p.start)).toBe('2026-09-01T04:00:00.000Z')
    expect(iso(p.end)).toBe('2026-10-01T04:00:00.000Z')
  })

  it('belongs to the previous period before the bill day', () => {
    const p = billingPeriod(u('2026-09-10T12:00:00Z'), TO, 15)
    expect(p.period).toBe('2026-08')
    expect(iso(p.start)).toBe('2026-08-15T04:00:00.000Z')
  })

  it('treats the first local hour of the month as the new period even though UTC is still last month', () => {
    expect(billingPeriod(u('2026-10-01T02:00:00Z'), TO).period).toBe('2026-09')
    expect(billingPeriod(u('2026-10-01T04:00:00Z'), TO).period).toBe('2026-10')
  })

  it('spans a DST change', () => {
    const p = billingPeriod(u('2026-11-10T12:00:00Z'), TO)
    expect(iso(p.start)).toBe('2026-11-01T04:00:00.000Z')
    expect(iso(p.end)).toBe('2026-12-01T05:00:00.000Z')
  })

  it('rejects bill days outside 1–28', () => {
    expect(() => billingPeriod(new Date(), TO, 0)).toThrow(RangeError)
    expect(() => billingPeriod(new Date(), TO, 29)).toThrow(RangeError)
    expect(() => billingPeriod(new Date(), TO, 1.5)).toThrow(RangeError)
  })
})
