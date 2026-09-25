/**
 * P2-06: settings schemas and calendar day types.
 */
import { describe, expect, it } from 'vitest'
import { DEMO_CALENDAR_INPUT, batteryPatch, calendarDayType, calendarInput, parseTopic, sitePatch, topics } from '../index'

describe('calendarDayType', () => {
  const cal = DEMO_CALENDAR_INPUT
  it('is open on term weekdays and closed on weekends, days off and between terms', () => {
    expect(calendarDayType(cal, '2026-09-24')).toBe('open') // Thursday in fall term
    expect(calendarDayType(cal, '2026-09-26')).toBe('closed') // Saturday
    expect(calendarDayType(cal, '2026-10-09')).toBe('closed') // PA day
    expect(calendarDayType(cal, '2026-12-23')).toBe('closed') // winter break
    expect(calendarDayType(cal, '2026-09-01')).toBe('closed') // before the first term
    expect(calendarDayType(cal, '2027-03-16')).toBe('closed') // between terms
    expect(calendarDayType(cal, '2027-03-23')).toBe('open') // spring term starts
  })

  it('opens term weekends when weekends are open', () => {
    expect(calendarDayType({ ...cal, weekends: 'open' }, '2026-09-26')).toBe('open')
    expect(calendarDayType({ ...cal, weekends: 'open' }, '2026-12-26')).toBe('closed') // still a day off
  })
})

describe('settings schemas', () => {
  it('accepts the demo calendar and rejects impossible dates', () => {
    expect(calendarInput.safeParse(DEMO_CALENDAR_INPUT).success).toBe(true)
    const feb30 = { ...DEMO_CALENDAR_INPUT, daysOff: [{ name: 'x', start: '2027-02-30', end: '2027-02-30' }] }
    expect(calendarInput.safeParse(feb30).success).toBe(false)
  })

  it('keeps the battery floor at 10% or more', () => {
    expect(batteryPatch.safeParse({ floorPct: 10 }).success).toBe(true)
    expect(batteryPatch.safeParse({ floorPct: 9.9 }).success).toBe(false)
  })

  it('knows real time zones', () => {
    expect(sitePatch.safeParse({ tz: 'Europe/Berlin' }).success).toBe(true)
    expect(sitePatch.safeParse({ tz: 'Europe/Atlantis' }).success).toBe(false)
  })

  it('parses the gateway config topic', () => {
    expect(parseTopic(topics.gatewayConfig('650000000000000000000001'))).toEqual({ kind: 'gatewayConfig', siteId: '650000000000000000000001' })
  })
})
