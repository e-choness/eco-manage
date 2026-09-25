import { describe, expect, it } from 'vitest'
import { DEMO_DEVICES, DEVICE_TYPES } from '@ecomanage/shared'
import {
  TELEMETRY_FIELDS,
  allowedFields,
  checkWriteParams,
  getProfile,
  loadProfiles,
  parseProfiles,
  profilesFor,
  undeclaredFields,
} from '../index'

describe('profile library', () => {
  it('loads the six plan profiles (P1-11)', () => {
    expect([...loadProfiles().keys()].sort()).toEqual([
      'ct-meter-3ph@2',
      'gateway@1',
      'ocpp16-generic@1',
      'sg-ready-heatpump@1',
      'sunspec-inverter@3',
      'sunspec-storage-802@2',
    ])
  })

  it('has a profile for every demo device, matching its type', () => {
    for (const d of DEMO_DEVICES) {
      const p = getProfile(d.profileId)
      expect({ device: d.key, found: !!p }).toEqual({ device: d.key, found: true })
      expect(p!.deviceTypes).toContain(d.type)
    }
  })

  it('covers every device type', () => {
    for (const t of DEVICE_TYPES) expect(profilesFor(t).length).toBeGreaterThan(0)
  })

  it('only declares standard telemetry fields', () => {
    for (const p of loadProfiles().values()) for (const f of p.fields) expect(TELEMETRY_FIELDS).toContain(f)
  })

  it('keeps the battery reserve floor at 10% and heat pump overrides to 2 h (spec §4)', () => {
    expect(getProfile('sunspec-storage-802@2')!.write.set_reserve.params.pct.min).toBe(10)
    expect(getProfile('sg-ready-heatpump@1')!.write.sg_mode.maxDurationMin).toBe(120)
  })

  it('offers the OCPP soft reset as the charger fix', () => {
    expect(getProfile('ocpp16-generic@1')!.fixes).toEqual([
      { id: 'soft-reset', label: 'Remote restart (OCPP soft reset)', action: 'reset', params: {} },
    ])
  })
})

describe('validation', () => {
  const base = {
    id: 'x@1',
    vendor: 'v',
    model: 'm',
    protocol: 'modbus-tcp',
    deviceTypes: ['pv'],
    fields: ['p_kw'],
    read: [{ field: 'p_kw', reg: 1, type: 'int16' }],
    pollMs: 5000,
    version: 1,
    reviewed: false,
  }

  it('accepts a minimal profile and fills defaults', () => {
    const p = parseProfiles([base]).get('x@1')!
    expect(p.write).toEqual({})
    expect(p.fixes).toEqual([])
  })

  it('rejects bad ids, version mismatches, unknown fields and broken references', () => {
    expect(() => parseProfiles([{ ...base, id: 'Bad Id' }])).toThrow(/Invalid device profile Bad Id/)
    expect(() => parseProfiles([{ ...base, version: 2 }])).toThrow(/version differ/)
    expect(() => parseProfiles([{ ...base, fields: ['p_kw', 'wind_ms'] }])).toThrow(/Invalid/)
    expect(() => parseProfiles([{ ...base, fields: [] }])).toThrow(/not in fields/)
    expect(() => parseProfiles([{ ...base, fixes: [{ id: 'f', label: 'l', action: 'nope' }] }])).toThrow(/unknown action nope/)
    expect(() => parseProfiles([base, base])).toThrow(/Duplicate/)
    expect(() => parseProfiles([null])).toThrow(/\(no id\)/)
  })
})

describe('readings against a profile', () => {
  const meter = getProfile('ct-meter-3ph@2')!

  it('always allows ts, q and p_kw', () => {
    expect([...allowedFields(meter)]).toEqual(expect.arrayContaining(['ts', 'q', 'p_kw', 'e_in_kwh']))
  })

  it('lists fields the profile does not declare', () => {
    expect(undeclaredFields(meter, { ts: 'x', p_kw: 1, e_in_kwh: 2 })).toEqual([])
    expect(undeclaredFields(meter, { ts: 'x', p_kw: 1, soc_pct: 50 })).toEqual(['soc_pct'])
  })
})

describe('write limits', () => {
  const bat = getProfile('sunspec-storage-802@2')!
  const hp = getProfile('sg-ready-heatpump@1')!

  it('accepts params inside the limits', () => {
    expect(checkWriteParams(bat.write.set_reserve, { pct: 20 })).toEqual([])
    expect(checkWriteParams(bat.write.grid_charge, { enabled: true })).toEqual([])
  })

  it('reports missing, out-of-range, wrong-type and unknown params', () => {
    expect(checkWriteParams(bat.write.set_reserve, {})).toEqual(['pct is required'])
    expect(checkWriteParams(bat.write.set_reserve, { pct: 5 })).toEqual(['pct must be at least 10%'])
    expect(checkWriteParams(bat.write.set_reserve, { pct: 101 })).toEqual(['pct must be at most 100%'])
    expect(checkWriteParams(bat.write.set_reserve, { pct: '20' })).toEqual(['pct must be a number'])
    expect(checkWriteParams(hp.write.sg_mode, { mode: 2.5, until: '14:00' })).toEqual(['mode must be a whole number'])
    expect(checkWriteParams(bat.write.grid_charge, { enabled: 'yes' })).toEqual(['enabled must be true or false'])
    expect(checkWriteParams(bat.write.set_reserve, { pct: 20, force: true })).toEqual(['force is not a parameter of this action'])
  })
})
