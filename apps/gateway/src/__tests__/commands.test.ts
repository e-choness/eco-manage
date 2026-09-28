/**
 * P5-04: commands on the real gateway, with the same limits as the simulator (P3-05). A fake
 * driver records what reaches the device; the clock is the test's.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { OFFLINE_REVERT_MS, getProfile } from '@ecomanage/profiles'
import { Commands } from '../commands'
import type { Driver } from '../drivers/types'
import { Store } from '../store'

const T0 = Date.parse('2026-09-28T10:00:00Z')
let now = T0
const iso = (ms: number) => new Date(ms).toISOString()
const log = { info: () => undefined, warn: () => undefined }

// A device that remembers what was written and undone; `failUndo` makes the next undo fail.
const calls: string[] = []
let failUndo = false
const driver: Driver = {
  read: async () => ({}),
  write: async (action, params) => {
    calls.push(`write ${action} ${JSON.stringify(params)}`)
    return action === 'restart' ? null : { before: action }
  },
  undo: async (action, undo) => {
    if (failUndo) {
      failUndo = false
      throw new Error('bus busy')
    }
    calls.push(`undo ${action} ${JSON.stringify(undo)}`)
  },
}
const devices = { bat: { id: 'bat', profile: getProfile('sunspec-storage-802@2')!, driver }, inv: { id: 'inv', profile: getProfile('sunspec-inverter@3')!, driver } }

let store: Store
let commands: Commands
const cmd = (over: Record<string, unknown>) => ({ deviceId: 'bat', action: 'force_discharge', params: { kw: 30, until: iso(now + 60 * 60_000) }, expiresAt: iso(now + 60_000), revertAt: null, ...over })

beforeEach(() => {
  now = T0
  calls.length = 0
  store = new Store()
  commands = new Commands(store, (id) => devices[id as keyof typeof devices], log, () => now)
})

describe('limits', () => {
  it('refuses what is expired, unknown, out of range or below the floor', async () => {
    expect(await commands.handle({ nonsense: true })).toMatchObject({ ok: false, error: 'malformed command' })
    expect(await commands.handle(cmd({ expiresAt: iso(now - 1) }))).toMatchObject({ ok: false, error: 'expired' })
    expect(await commands.handle(cmd({ deviceId: 'ghost' }))).toMatchObject({ ok: false, error: 'unknown device' })
    expect(await commands.handle(cmd({ params: { kw: 90, until: iso(now + 60_000) } }))).toMatchObject({ ok: false, error: 'kw must be at most 60kW' })
    expect((await commands.handle(cmd({ params: { kw: 30, until: iso(now + 8 * 3_600_000) } }))).error).toMatch(/longer than the 360 min limit/)
    commands.setFloor(25)
    expect(await commands.handle(cmd({ action: 'set_reserve', params: { pct: 20 } }))).toMatchObject({ ok: false, error: 'reserve 20% is below the 25% hardware minimum' })
    expect(await commands.handle(cmd({ action: 'dance', params: {} }))).toMatchObject({ ok: false, error: 'action dance is not supported' })
    expect(calls).toEqual([])
  })

  it('gives a time-limited action without an end one, and undoes it then', async () => {
    const ack = await commands.handle(cmd({ deviceId: 'inv', action: 'export_limit', params: { pct: 50 } }))
    expect(ack).toEqual({ ok: true, ts: iso(now) })
    expect(calls).toEqual([`write export_limit {"pct":50,"until":"${iso(T0 + 240 * 60_000)}"}`])
    now = T0 + 239 * 60_000
    await commands.tick(true)
    expect(calls).toHaveLength(1)
    now = T0 + 240 * 60_000
    await commands.tick(true)
    expect(calls[1]).toBe('undo export_limit {"before":"export_limit"}')
    expect(store.reverts()).toEqual([])
  })
})

describe('undoing', () => {
  it('ends on time even after a restart, and retries an undo that failed', async () => {
    await commands.handle(cmd({}))
    // The gateway restarts: a new Commands on the same store.
    const again = new Commands(store, (id) => devices[id as keyof typeof devices], log, () => now)
    now = T0 + 60 * 60_000
    failUndo = true
    await again.tick(true)
    expect(store.reverts()).toHaveLength(1)
    await again.tick(true)
    expect(calls.at(-1)).toBe('undo force_discharge {"before":"force_discharge"}')
    expect(store.reverts()).toEqual([])
  })

  it('undoes everything on the cloud’s revert, and a permanent setting replaces a pending undo', async () => {
    await commands.handle(cmd({}))
    await commands.handle(cmd({ action: 'set_reserve', params: { pct: 40 }, revertAt: iso(now + 30 * 60_000) }))
    expect(store.reverts().map((r) => r.action).sort()).toEqual(['force_discharge', 'set_reserve'])
    await commands.handle(cmd({ action: 'set_reserve', params: { pct: 30 } }))
    expect(store.reverts().map((r) => r.action)).toEqual(['force_discharge'])
    expect(await commands.handle(cmd({ action: 'revert', params: {} }))).toMatchObject({ ok: true })
    expect(store.reverts()).toEqual([])
    expect(calls.filter((c) => c.startsWith('undo'))).toEqual(['undo force_discharge {"before":"force_discharge"}'])
  })

  it('undoes everything the cloud set after 15 minutes offline, once per outage', async () => {
    await commands.handle(cmd({}))
    await commands.tick(false)
    now += OFFLINE_REVERT_MS - 1000
    await commands.tick(false)
    expect(store.reverts()).toHaveLength(1)
    now += 1000
    await commands.tick(false)
    expect(store.reverts()).toEqual([])
    await commands.handle(cmd({}))
    now += 60_000
    await commands.tick(false) // same outage: the new command stays
    expect(store.reverts()).toHaveLength(1)
    await commands.tick(true)
    await commands.tick(false)
    now += OFFLINE_REVERT_MS
    await commands.tick(false)
    expect(store.reverts()).toEqual([])
  })

  it('reports a device that refuses, and keeps nothing to undo for a restart', async () => {
    const refusing: Driver = { ...driver, write: async () => Promise.reject(new Error('Illegal data value')) }
    const c = new Commands(store, () => ({ id: 'inv', profile: devices.inv.profile, driver: refusing }), log, () => now)
    expect(await c.handle(cmd({ deviceId: 'inv', action: 'export_limit', params: { pct: 10 } }))).toMatchObject({ ok: false, error: 'Illegal data value' })
    expect(await commands.handle(cmd({ deviceId: 'inv', action: 'restart', params: {} }))).toMatchObject({ ok: true })
    expect(store.reverts()).toEqual([])
    expect(commands.floorPct()).toBe(10)
  })
})
