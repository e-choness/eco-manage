/**
 * P5-04: Modbus registers to reading fields, as the device profiles say, and back for writes.
 */
import { describe, expect, it } from 'vitest'
import { getProfile } from '@ecomanage/profiles'
import { decodeScale, decodeValue, emptyRegisters, fieldsFrom, readPlan, storeBlock } from '../modbus/decode'
import { encodeValue, toRaw } from '../modbus/encode'

const f32 = (x: number) => {
  const v = new DataView(new ArrayBuffer(4))
  v.setFloat32(0, x)
  return [v.getUint16(0), v.getUint16(2)]
}

describe('decodeValue', () => {
  it('reads each type, high word first', () => {
    expect(decodeValue('uint16', [65000])).toBe(65000)
    expect(decodeValue('int16', [0xfffe])).toBe(-2)
    expect(decodeValue('int32', [0xffff, 0xfffe])).toBe(-2)
    expect(decodeValue('uint32', [1, 2])).toBe(65538)
    expect(decodeValue('acc32', [0x0001, 0x86a0])).toBe(100_000)
    expect(decodeValue('acc64', [0, 0, 1, 0])).toBe(65536)
    expect(decodeValue('float32', f32(230.5))).toBeCloseTo(230.5, 3)
    expect(decodeValue('enum16', [4])).toBe(4)
    expect(decodeValue('bitfield32', [0, 0b1001])).toBe(9)
  })

  it('gives null for what SunSpec marks as not implemented, or too few words', () => {
    expect(decodeValue('int16', [0x8000])).toBeNull()
    expect(decodeValue('uint16', [0xffff])).toBeNull()
    expect(decodeValue('uint32', [0xffff, 0xffff])).toBeNull()
    expect(decodeValue('int32', [0x8000, 0])).toBeNull()
    expect(decodeValue('float32', [0x7fc0, 0])).toBeNull() // NaN
    expect(decodeValue('uint32', [1])).toBeNull()
    expect(decodeScale(0x8000)).toBeNull()
    expect(decodeScale(0xfffd)).toBe(-3)
    expect(decodeScale(2)).toBe(2)
  })
})

describe('readPlan', () => {
  it('reads the SunSpec inverter in one block, scale factors included', () => {
    expect(readPlan(getProfile('sunspec-inverter@3')!)).toEqual([{ table: 'holding', start: 40071, count: 40 }])
  })

  it('keeps the CT meter in input registers, split where the gap is large', () => {
    expect(readPlan(getProfile('ct-meter-3ph@2')!)).toEqual([
      { table: 'input', start: 0, count: 8 },
      { table: 'input', start: 52, count: 24 },
    ])
  })
})

describe('fieldsFrom', () => {
  it('turns inverter registers into fields with their scale factors, state and faults', () => {
    const p = getProfile('sunspec-inverter@3')!
    const regs = emptyRegisters()
    const words = new Array(40).fill(0xffff)
    const set = (reg: number, v: number) => (words[reg - 40071] = v)
    set(40083, 4213) // W
    set(40084, 1) // W_SF: ×10 → 42 130 W
    set(40093, 0x0012)
    set(40094, 0xd687) // WH 1 234 567
    set(40095, 0) // WH_SF
    set(40071, 614)
    set(40075, 0x8000) // A_SF not implemented → no a
    set(40079, 2301)
    set(40082, 0xffff) // V_SF = -1 → 230.1 V
    set(40085, 5999)
    set(40086, 0xfffe) // Hz_SF = -2
    set(40091, 98)
    set(40092, 0) // PF 98 × 0.01
    set(40102, 0x8000) // temperature not implemented
    set(40107, 4)
    set(40109, 0)
    set(40110, 0b10000001) // bits 0 and 7
    storeBlock(regs, { table: 'holding', start: 40071, count: 40 }, words)
    expect(fieldsFrom(p, regs)).toEqual({
      p_kw: 42.13,
      e_out_kwh: 1234.567,
      v: [230.1],
      hz: 59.99,
      pf: 0.98,
      state: 'running',
      fault: [
        { code: 'bit0', text: 'Ground fault' },
        { code: 'bit7', text: 'Over temperature' },
      ],
    })
  })

  it('reads the meter’s floats, and names an unknown state by its number', () => {
    const regs = emptyRegisters()
    storeBlock(regs, { table: 'input', start: 0, count: 8 }, [...f32(231), 0, 0, 0, 0, ...f32(12.5)])
    storeBlock(regs, { table: 'input', start: 52, count: 24 }, [...f32(-3200), ...new Array(16).fill(0), ...f32(50), ...f32(812.25)])
    expect(fieldsFrom(getProfile('ct-meter-3ph@2')!, regs)).toMatchObject({ p_kw: -3.2, v: [231], a: [12.5], hz: 50, e_in_kwh: 812.25 })

    const battery = getProfile('sunspec-storage-802@2')!
    const b = emptyRegisters()
    b.holding.set(40156, 9)
    expect(fieldsFrom(battery, b)).toEqual({ state: '9' })
  })
})

describe('encodeValue', () => {
  it('writes each type and refuses what doesn’t fit', () => {
    expect(encodeValue('uint16', 60)).toEqual([60])
    expect(encodeValue('int16', -2)).toEqual([0xfffe])
    expect(encodeValue('int32', -2)).toEqual([0xffff, 0xfffe])
    expect(encodeValue('uint32', 65538)).toEqual([1, 2])
    expect(decodeValue('float32', encodeValue('float32', 12.5))).toBe(12.5)
    expect(() => encodeValue('uint16', -1)).toThrow('doesn’t fit')
    expect(() => encodeValue('int16', Number.NaN)).toThrow('Not a number')
    expect(toRaw(60, 1, -1)).toBe(600)
    expect(toRaw(5, 0.001)).toBe(5000)
  })
})
