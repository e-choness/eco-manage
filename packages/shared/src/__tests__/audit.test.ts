/**
 * P3-07: the audit log query. The API's tests cover reading the log.
 */
import { describe, expect, it } from 'vitest'
import { auditQuery } from '../index'

describe('auditQuery', () => {
  it('defaults to the latest 50', () => {
    expect(auditQuery.parse({})).toEqual({ limit: 50 })
  })

  it('takes an action or group, a person, a target and a time range', () => {
    const q = { action: 'device', userId: '66f2c0ffee0000000000abcd', target: 'device:1', from: '2026-09-01', to: '2026-09-26T12:00:00Z' }
    expect(auditQuery.parse(q)).toEqual({ ...q, limit: 50 })
  })

  it('refuses a bad date, person or action', () => {
    expect(auditQuery.safeParse({ from: 'last week' }).success).toBe(false)
    expect(auditQuery.safeParse({ userId: 'me' }).success).toBe(false)
    expect(auditQuery.safeParse({ action: '$where' }).success).toBe(false)
    expect(auditQuery.safeParse({ limit: '1000' }).success).toBe(false)
  })
})
