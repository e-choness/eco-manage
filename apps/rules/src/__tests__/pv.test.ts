/**
 * P2-07: expected solar output from the other inverters.
 */
import { describe, expect, it } from 'vitest'
import { BUCKET_MS, bucketize, pvRatios } from '../pv'

const T0 = Date.parse('2026-09-24T16:00:00Z')
const at = (bucket: number, sec = 0) => new Date(T0 + bucket * BUCKET_MS + sec * 1000)

describe('bucketize', () => {
  it('averages each device per 5-minute bucket and ignores standby draw', () => {
    const b = bucketize([
      { deviceId: 'a', ts: at(0, 5), kw: 30 },
      { deviceId: 'a', ts: at(0, 200), kw: 34 },
      { deviceId: 'a', ts: at(1), kw: -0.1 },
      { deviceId: 'b', ts: at(0), kw: 20 },
    ])
    expect(b.get('a')).toEqual(new Map([[T0, 32], [T0 + BUCKET_MS, 0]]))
    expect(b.get('b')).toEqual(new Map([[T0, 20]]))
  })
})

describe('pvRatios', () => {
  const kwp = new Map([['invA', 48], ['invB', 38]])

  it('compares each inverter with the others per kWp', () => {
    // invA makes 24 kW from 48 kWp (0.5 kW/kWp): invB should make 19, makes 15.2 → 80%
    const buckets = new Map([
      ['invA', new Map([[T0, 24]])],
      ['invB', new Map([[T0, 15.2]])],
    ])
    const r = pvRatios(buckets, kwp)
    expect(r.get('invB')![0]).toBeCloseTo(0.8)
    expect(r.get('invA')![0]).toBeCloseTo(1.25)
  })

  it('skips night, missing buckets and sites with one inverter', () => {
    const buckets = new Map([
      ['invA', new Map([[T0, 1], [T0 + BUCKET_MS, 20]])], // 1/48 kWp: night
      ['invB', new Map([[T0, 0.5], [T0 + 2 * BUCKET_MS, 15]])],
    ])
    expect(pvRatios(buckets, kwp)).toEqual(new Map([['invA', []], ['invB', []]]))
    expect(pvRatios(buckets, new Map([['invA', 48]]))).toEqual(new Map())
    expect(pvRatios(buckets, new Map([['invA', 48], ['invB', 0]]))).toEqual(new Map())
  })
})
