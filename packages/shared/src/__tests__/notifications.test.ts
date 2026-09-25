/**
 * P2-09: quiet hours and notification settings.
 */
import { describe, expect, it } from 'vitest'
import { inQuietHours, notificationPrefsPatch } from '../index'

const TO = 'America/Toronto'
const at = (iso: string) => new Date(iso)

describe('inQuietHours', () => {
  it('wraps midnight: 22:00–06:30 local', () => {
    expect(inQuietHours(at('2026-09-25T02:30:00Z'), TO, '22:00', '06:30')).toBe(true) // 22:30 EDT
    expect(inQuietHours(at('2026-09-25T10:00:00Z'), TO, '22:00', '06:30')).toBe(true) // 06:00
    expect(inQuietHours(at('2026-09-25T10:30:00Z'), TO, '22:00', '06:30')).toBe(false) // 06:30 ends it
    expect(inQuietHours(at('2026-09-25T16:00:00Z'), TO, '22:00', '06:30')).toBe(false) // 12:00
  })

  it('works within a day, and off when unset or empty', () => {
    expect(inQuietHours(at('2026-09-25T17:00:00Z'), TO, '12:00', '14:00')).toBe(true) // 13:00
    expect(inQuietHours(at('2026-09-25T19:00:00Z'), TO, '12:00', '14:00')).toBe(false) // 15:00
    expect(inQuietHours(at('2026-09-25T02:30:00Z'), TO, null, null)).toBe(false)
    expect(inQuietHours(at('2026-09-25T02:30:00Z'), TO, '22:00', '22:00')).toBe(false)
  })
})

describe('notificationPrefsPatch', () => {
  it('accepts partial changes and turning quiet hours off together', () => {
    expect(notificationPrefsPatch.parse({ email: ' Jamie@MapleGrove.edu ' })).toEqual({ email: 'jamie@maplegrove.edu' })
    expect(notificationPrefsPatch.safeParse({ quietFrom: null, quietTo: null }).success).toBe(true)
  })

  it('rejects half quiet hours, bad times, tiny escalation and unknown fields', () => {
    for (const body of [{ quietFrom: '22:00' }, { quietFrom: '25:00', quietTo: '06:00' }, { escalateMin: 1 }, { sms: true }, {}])
      expect(notificationPrefsPatch.safeParse(body).success).toBe(false)
  })
})
