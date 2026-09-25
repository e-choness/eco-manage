import { describe, expect, it } from 'vitest'
import { costCents, formatMoney, fromCents, kwFromKwh, kwhFromKw, round, toCents } from '../units'

describe('units', () => {
  it('converts power over time to energy and back', () => {
    expect(kwhFromKw(60, 15)).toBe(15)
    expect(kwFromKwh(15, 15)).toBe(60)
    expect(() => kwFromKwh(1, 0)).toThrow(RangeError)
  })

  it('rounds without floating-point drift', () => {
    expect(round(1.005)).toBe(1.01)
    expect(round(2.345, 1)).toBe(2.3)
    expect(round(7)).toBe(7)
  })

  it('handles money as integer cents', () => {
    expect(toCents(34.18)).toBe(3418)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(fromCents(3418)).toBe(34.18)
    expect(costCents(42, 16)).toBe(672)
    expect(costCents(0.333, 27)).toBe(9)
  })

  it('formats cents for display', () => {
    expect(formatMoney(341800)).toBe('$3,418.00')
    expect(formatMoney(-500, 'USD', 'en-US')).toBe('-$5.00')
  })
})
