/**
 * P3-05: gateway-side safety in the simulated gateway. Each test tries to break one limit: the
 * reserve floor, the longest duration, stale commands, and being cut off from the cloud.
 */
import { describe, expect, it } from 'vitest'
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, parseTopic, topics } from '@ecomanage/shared'
import { SiteEngine } from '../engine/site'
import { Gateway } from '../gateway'

const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!
const T0 = new Date('2026-09-24T16:00:00Z') // 12:00 EDT, sunny school day
const at = (from: Date, min: number) => new Date(from.getTime() + min * 60_000).toISOString()

const site = () => {
  const engine = new SiteEngine({ tz: DEMO_SITE.tz, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: 42, devices: DEMO_DEVICES }, T0)
  const acks = new Map<string, { ok: boolean; error?: string }>()
  const gateway = new Gateway(engine, DEMO_SITE_ID, (topic, payload) => {
    const t = parseTopic(topic)
    if (t?.kind === 'commandAck') acks.set(t.commandId, payload as { ok: boolean; error?: string })
  })
  let n = 0
  const send = (key: string, action: string, params: Record<string, unknown>, over: { expiresAt?: string; revertAt?: string | null } = {}) => {
    const id = `c${++n}`
    gateway.handleMessage(topics.command(DEMO_SITE_ID, id), { deviceId: dev(key).id, action, params, expiresAt: at(engine.now, 5), revertAt: null, ...over })
    return acks.get(id)
  }
  const run = (seconds: number) => {
    for (let s = 0; s < seconds; s += 5) {
      engine.step(5)
      gateway.tick()
    }
  }
  return { engine, gateway, send, run }
}

describe('reserve floor', () => {
  it('refuses a reserve under the hardware minimum the cloud configured', () => {
    const s = site()
    s.gateway.handleMessage(topics.gatewayConfig(DEMO_SITE_ID), { ts: T0.toISOString(), batteryFloorPct: 25 })
    expect(s.send('bat', 'set_reserve', { pct: 20 })).toEqual({ ok: false, error: 'reserve 20% is below the 25% hardware minimum', ts: expect.any(String) })
    expect(s.engine.batteryState().reservePct).toBe(25)
  })

  it('never discharges below the reserve, however long or hard it is told to', () => {
    const s = site()
    expect(s.send('bat', 'force_discharge', { kw: 60, until: at(T0, 360) })).toMatchObject({ ok: true })
    let lowest = 100
    for (let m = 0; m < 360; m += 5) {
      s.run(5 * 60)
      lowest = Math.min(lowest, s.engine.batteryState().socPct)
    }
    expect(lowest).toBeGreaterThanOrEqual(s.engine.batteryState().reservePct - 0.5)
    expect(s.engine.powerOf('bat')).toBeLessThan(1) // stopped at the reserve
  })
})

describe('longest duration', () => {
  it('refuses a discharge longer than the battery profile allows', () => {
    const s = site()
    expect(s.send('bat', 'force_discharge', { kw: 30, until: at(T0, 7 * 60) })).toMatchObject({ ok: false, error: 'runs 420 min, longer than the 360 min limit' })
    expect(s.engine.overrides().battery).toBeNull()
  })

  it('ends an export limit sent without an end after its 4 h limit', () => {
    const s = site()
    expect(s.send('invA', 'export_limit', { pct: 0 })).toMatchObject({ ok: true })
    s.run(239 * 60)
    expect(s.engine.overrides().exportLimits).toEqual(['invA'])
    s.run(2 * 60)
    expect(s.engine.overrides().exportLimits).toEqual([])
  })

  it('ends a charging profile at its validTo', () => {
    const s = site()
    const schedule = [{ start: T0.toISOString(), limitA: 6 }]
    expect(s.send('ev1', 'set_charging_profile', { schedule, validTo: at(T0, 30) })).toMatchObject({ ok: true })
    expect(s.engine.evLimitA('ev1')).toBe(6)
    s.run(31 * 60)
    expect(s.engine.evLimitA('ev1')).toBe(32)
  })
})

describe('stale commands', () => {
  it('refuses a command that expired while it waited, e.g. in a queue during an outage', () => {
    const s = site()
    s.gateway.addFault({ type: 'gateway-offline', minutes: 10 })
    const late = { expiresAt: at(T0, 5) }
    s.run(11 * 60) // back online after 10 min; the broker hands over what it held
    expect(s.send('bat', 'force_discharge', { kw: 30, until: at(s.engine.now, 60) }, late)).toMatchObject({ ok: false, error: 'expired' })
    expect(s.engine.overrides().battery).toBeNull()
  })
})

describe('cut off from the cloud', () => {
  it('undoes everything the cloud set after 15 minutes offline, and not before', () => {
    const s = site()
    const before = s.engine.batteryState().reservePct
    expect(s.send('bat', 'force_discharge', { kw: 20, until: at(T0, 180) })).toMatchObject({ ok: true })
    expect(s.send('invB', 'export_limit', { pct: 50 }, { revertAt: at(T0, 180) })).toMatchObject({ ok: true })
    expect(s.send('ev1', 'limit_current', { amps: 10, until: at(T0, 180) })).toMatchObject({ ok: true })
    expect(s.send('hp', 'sg_mode', { mode: 1, until: at(T0, 110) })).toMatchObject({ ok: true })
    expect(s.send('bat', 'set_reserve', { pct: 70 }, { revertAt: at(T0, 180) })).toMatchObject({ ok: true })
    expect(s.engine.overrides()).toEqual({ battery: 'force_discharge', reservePct: 70, exportLimits: ['invB'], evLimits: ['ev1'], evSchedules: [], heatPump: 'sg_mode' })

    s.gateway.addFault({ type: 'gateway-offline' })
    s.run(14 * 60)
    expect(s.engine.overrides().battery).toBe('force_discharge') // still trusting the cloud
    s.run(2 * 60)
    expect(s.engine.overrides()).toEqual({ battery: null, reservePct: before, exportLimits: [], evLimits: [], evSchedules: [], heatPump: null })
    expect(s.gateway.safetyState().lastSafetyRevert).not.toBeNull()

    s.gateway.clearFaults()
    s.run(60)
    expect(s.engine.overrides().battery).toBeNull() // coming back doesn't bring them back
    expect(s.gateway.safetyState().offlineSince).toBeNull()
  })

  it('a short outage changes nothing', () => {
    const s = site()
    s.send('bat', 'force_discharge', { kw: 20, until: at(T0, 180) })
    s.gateway.addFault({ type: 'gateway-offline', minutes: 10 })
    s.run(20 * 60)
    expect(s.engine.overrides().battery).toBe('force_discharge')
    expect(s.gateway.safetyState().lastSafetyRevert).toBeNull()
  })

  it('puts a reserve change back at its revert time even if the cloud’s revert never comes', () => {
    const s = site()
    const before = s.engine.batteryState().reservePct
    s.send('bat', 'set_reserve', { pct: 80 }, { revertAt: at(T0, 30) })
    s.run(29 * 60)
    expect(s.engine.batteryState().reservePct).toBe(80)
    s.run(2 * 60)
    expect(s.engine.batteryState().reservePct).toBe(before)
    // A permanent change (no revert time) stays.
    s.send('bat', 'set_reserve', { pct: 40 })
    s.run(60 * 60)
    expect(s.engine.batteryState().reservePct).toBe(40)
  })
})
