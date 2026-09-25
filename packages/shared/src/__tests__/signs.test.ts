import { describe, expect, it } from 'vitest'
import { buildingKw, displayKw, flowDirection, isLoad, toSiteSign } from '../signs'

describe('sign rules', () => {
  it('knows which device types are loads', () => {
    expect(isLoad('ev')).toBe(true)
    expect(isLoad('heatpump')).toBe(true)
    expect(isLoad('submeter')).toBe(true)
    expect(isLoad('pv')).toBe(false)
    expect(isLoad('meter')).toBe(false)
  })

  it('shows loads as positive and keeps other signs', () => {
    expect(displayKw('ev', -7.4)).toBe(7.4)
    expect(displayKw('battery', -20)).toBe(-20)
    expect(displayKw('meter', 12.8)).toBe(12.8)
  })

  it('stores loads as negative whatever sign they arrive with', () => {
    expect(toSiteSign('heatpump', 18)).toBe(-18)
    expect(toSiteSign('heatpump', -18)).toBe(-18)
    expect(toSiteSign('pv', 36.1)).toBe(36.1)
  })

  it('reads flow direction with a dead band', () => {
    expect(flowDirection(1)).toBe('in')
    expect(flowDirection(-1)).toBe('out')
    expect(flowDirection(0.01)).toBe('idle')
    expect(flowDirection(0.5, 1)).toBe('idle')
  })

  it('works out the unmetered building load from the site balance', () => {
    // App v2 demo values: PV 61.4, battery discharging 20, importing 12.8, EVs 14.6, heat pump 18
    expect(buildingKw({ pv: 61.4, battery: 20, meter: 12.8, ev: -14.6, heatpump: -18 })).toBeCloseTo(61.6)
    expect(buildingKw({ pv: 10, battery: -5, meter: -2, ev: 0, heatpump: 0, submeters: -1 })).toBeCloseTo(2)
  })
})
