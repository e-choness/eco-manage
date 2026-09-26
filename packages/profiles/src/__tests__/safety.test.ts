/**
 * P3-05: the gateway's own safety checks, trying to break each limit.
 */
import { describe, expect, it } from 'vitest'
import { OFFLINE_REVERT_MS, checkCommandSafety, getProfile } from '../index'

const NOW = Date.parse('2026-09-24T18:00:00Z')
const at = (min: number) => new Date(NOW + min * 60_000).toISOString()
const battery = getProfile('sunspec-storage-802@2')!.write
const inverter = getProfile('sunspec-inverter@3')!.write
const charger = getProfile('ocpp16-generic@1')!.write
const state = { now: NOW, batteryFloorPct: 20 }
const cmd = (action: string, params: Record<string, unknown>, over: object = {}) => ({ action, params, expiresAt: at(5), revertAt: null, ...over })

describe('checkCommandSafety', () => {
  it('lets a sound command through, with its end', () => {
    expect(checkCommandSafety(cmd('force_discharge', { kw: 30, until: at(180) }), battery.force_discharge, state)).toEqual({ problems: [], endsAt: NOW + 180 * 60_000 })
  })

  it('refuses expired commands, however good they are otherwise', () => {
    expect(checkCommandSafety(cmd('force_discharge', { kw: 30, until: at(60) }, { expiresAt: at(0) }), battery.force_discharge, state).problems).toEqual(['expired'])
    expect(checkCommandSafety(cmd('revert', {}, { expiresAt: at(-1) }), undefined, state).problems).toEqual(['expired'])
  })

  it('keeps the reserve at or above the hardware minimum', () => {
    expect(checkCommandSafety(cmd('set_reserve', { pct: 15 }), battery.set_reserve, state).problems).toEqual(['reserve 15% is below the 20% hardware minimum'])
    expect(checkCommandSafety(cmd('set_reserve', { pct: 5 }), battery.set_reserve, state).problems).toEqual(['pct must be at least 10%', 'reserve 5% is below the 20% hardware minimum'])
    expect(checkCommandSafety(cmd('set_reserve', { pct: 20 }), battery.set_reserve, state).problems).toEqual([])
  })

  it('refuses anything running past the action’s longest duration, or ending in the past', () => {
    expect(checkCommandSafety(cmd('force_discharge', { kw: 30, until: at(361) }), battery.force_discharge, state).problems).toEqual(['runs 361 min, longer than the 360 min limit'])
    expect(checkCommandSafety(cmd('limit_current', { amps: 16, until: at(300) }), charger.limit_current, state).problems).toEqual(['runs 300 min, longer than the 240 min limit'])
    expect(checkCommandSafety(cmd('set_charging_profile', { schedule: [], validTo: at(1500) }), charger.set_charging_profile, state).problems).toEqual(['runs 1500 min, longer than the 1440 min limit'])
    expect(checkCommandSafety(cmd('force_charge', { kw: 20, until: at(-5) }), battery.force_charge, state).problems).toEqual(['ends in the past'])
  })

  it('gives a time-limited action sent without an end its longest duration', () => {
    expect(checkCommandSafety(cmd('export_limit', { pct: 0 }), inverter.export_limit, state)).toEqual({ problems: [], endsAt: NOW + 240 * 60_000 })
    expect(checkCommandSafety(cmd('set_reserve', { pct: 50 }), battery.set_reserve, state).endsAt).toBeNull() // not time-limited
  })

  it('still checks the profile’s own limits, and unknown actions', () => {
    expect(checkCommandSafety(cmd('force_discharge', { kw: 90, until: at(30) }), battery.force_discharge, state).problems).toEqual(['kw must be at most 60kW'])
    expect(checkCommandSafety(cmd('self_destruct', {}), undefined, state).problems).toEqual(['action self_destruct is not supported'])
    expect(checkCommandSafety(cmd('revert', {}), undefined, state).problems).toEqual([])
  })

  it('reverts after 15 minutes offline', () => {
    expect(OFFLINE_REVERT_MS).toBe(15 * 60_000)
  })
})

describe('the command’s revert time as the end', () => {
  it('bounds an action without its own end, and is held to the same limit', () => {
    expect(checkCommandSafety(cmd('export_limit', { pct: 0 }, { revertAt: at(120) }), inverter.export_limit, state)).toEqual({ problems: [], endsAt: NOW + 120 * 60_000 })
    expect(checkCommandSafety(cmd('export_limit', { pct: 0 }, { revertAt: at(300) }), inverter.export_limit, state).problems).toEqual(['runs 300 min, longer than the 240 min limit'])
  })
})
