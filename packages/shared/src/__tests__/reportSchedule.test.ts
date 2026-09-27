/**
 * P5-01: report schedules run on the 1st (monthly) or Monday (weekly) at 07:00 site time and cover
 * the previous full month or week.
 */
import { describe, expect, it } from 'vitest'
import { nextReportRun, reportCron, reportRunRange, reportSchedulerId } from '../reportSchedule'
import { reportOnceJobId } from '../jobs'

const TO = 'America/Toronto'
const SYD = 'Australia/Sydney'

describe('report schedules', () => {
  it('have one scheduler per report with a cron in site time', () => {
    expect(reportCron('monthly')).toBe('0 7 1 * *')
    expect(reportCron('weekly')).toBe('0 7 * * 1')
    expect(reportSchedulerId('abc')).toBe('report:abc')
    expect(reportOnceJobId('abc')).toBe('report-once-abc')
  })

  it('run next on the 1st at 07:00 site time, across a DST change', () => {
    expect(nextReportRun('monthly', TO, new Date('2026-09-27T12:00:00Z')).toISOString()).toBe('2026-10-01T11:00:00.000Z') // EDT
    // Clocks go back on 1 Nov 2026, at 02:00: 07:00 is then EST.
    expect(nextReportRun('monthly', TO, new Date('2026-10-01T11:00:00Z')).toISOString()).toBe('2026-11-01T12:00:00.000Z')
    // Before 07:00 on the 1st, the run is that morning.
    expect(nextReportRun('monthly', TO, new Date('2026-10-01T10:59:00Z')).toISOString()).toBe('2026-10-01T11:00:00.000Z')
    expect(nextReportRun('monthly', SYD, new Date('2026-09-30T20:00:00Z')).toISOString()).toBe('2026-09-30T21:00:00.000Z') // 1 Oct 07:00 AEST
  })

  it('run next on Monday at 07:00 site time', () => {
    expect(nextReportRun('weekly', TO, new Date('2026-09-27T12:00:00Z')).toISOString()).toBe('2026-09-28T11:00:00.000Z') // Sun → Mon
    expect(nextReportRun('weekly', TO, new Date('2026-09-28T11:00:00Z')).toISOString()).toBe('2026-10-05T11:00:00.000Z')
  })

  it('cover the previous full month or week', () => {
    expect(reportRunRange('monthly', new Date('2026-10-01T11:00:00Z'), TO)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(reportRunRange('monthly', new Date('2026-03-01T12:30:00Z'), TO)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(reportRunRange('weekly', new Date('2026-09-28T11:00:00Z'), TO)).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    // UTC is still 30 Sep, but it is already 1 Oct in Sydney.
    expect(reportRunRange('monthly', new Date('2026-09-30T21:00:00Z'), SYD)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('refuse an unknown zone', () => {
    expect(() => nextReportRun('monthly', 'Mars/Base', new Date())).toThrow(RangeError)
  })
})
