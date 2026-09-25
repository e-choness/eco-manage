/**
 * P2-06: settings schemas and calendar day types.
 */
import { describe, expect, it } from 'vitest'
import { DEMO_CALENDAR_INPUT, alertActions, alertKey, dedupeKeyOf, quarterOf, siteDayClass, batteryPatch, calendarDayType, calendarInput, parseTopic, sitePatch, topics } from '../index'

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

describe('alert keys', () => {
  it('name one rule and device, or the whole site', () => {
    expect(alertKey('device-silent', 'ev3')).toBe('device-silent|ev3')
    expect(alertKey('demand-near-cap', null)).toBe('demand-near-cap|')
  })
})

describe('alert buttons (Backend Coverage §3)', () => {
  it('ack while open; snooze, fix and false alarm while the condition is true; resolve once it cleared', () => {
    expect(alertActions({ state: 'open', condition: 'active' }, true)).toEqual({ ack: true, snooze: true, fix: true, resolve: false, falseAlarm: true })
    expect(alertActions({ state: 'ack', condition: 'active' }, false)).toEqual({ ack: false, snooze: true, fix: false, resolve: false, falseAlarm: true })
    expect(alertActions({ state: 'open', condition: 'cleared' }, true)).toEqual({ ack: true, snooze: false, fix: false, resolve: true, falseAlarm: false })
    expect(alertActions({ state: 'resolved', condition: 'cleared' }, true)).toEqual({ ack: false, snooze: false, fix: false, resolve: false, falseAlarm: false })
  })
})

describe('recommendation helpers', () => {
  it('key proposals by rule, device and window, and run on quarter hours', () => {
    const w = { start: new Date('2026-09-24T18:00:00Z'), end: new Date('2026-09-24T21:00:00Z') }
    expect(dedupeKeyOf('peak-shaving', 'bat', w)).toBe('peak-shaving|bat|2026-09-24T18:00:00.000Z|2026-09-24T21:00:00.000Z')
    expect(quarterOf(new Date('2026-09-24T16:44:59Z'))).toEqual(new Date('2026-09-24T16:30:00Z'))
    expect(quarterOf(new Date('2026-09-24T16:45:00Z'))).toEqual(new Date('2026-09-24T16:45:00Z'))
  })

  it('classes days as open or closed from the calendar, or by weekday without one', () => {
    expect(siteDayClass('2026-09-24', DEMO_CALENDAR_INPUT)).toBe('open')
    expect(siteDayClass('2026-10-09', DEMO_CALENDAR_INPUT)).toBe('closed') // PA day
    expect(siteDayClass('2026-10-09', null)).toBe('open') // a Friday
    expect(siteDayClass('2026-10-10', { terms: [], daysOff: [], weekends: 'closed' })).toBe('closed')
  })
})
