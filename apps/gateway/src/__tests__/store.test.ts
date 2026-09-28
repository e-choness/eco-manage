/**
 * P5-04: the gateway's SQLite store — the 7-day buffer, devices, pending undos and settings.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Store } from '../store'

const reading = (ts: string, p_kw = 1) => ({ ts, p_kw, q: 'ok' as const })
const dir = mkdtempSync(join(tmpdir(), 'gw-store-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the buffer', () => {
  it('keeps readings in arrival order and drops them once delivered', () => {
    const s = new Store()
    s.push('a', reading('2026-09-28T10:00:00Z'))
    s.push('b', reading('2026-09-28T10:00:05Z'))
    s.push('a', reading('2026-09-28T10:00:10Z'))
    expect(s.count()).toBe(3)
    expect(s.oldestTs()).toBe('2026-09-28T10:00:00Z')
    const first = s.peek(2)
    expect(first.map((r) => r.deviceId)).toEqual(['a', 'b'])
    s.ack(first[1].id)
    expect(s.peek(10).map((r) => r.reading.ts)).toEqual(['2026-09-28T10:00:10Z'])
  })

  it('keeps 7 days', () => {
    const s = new Store()
    const now = Date.parse('2026-09-28T12:00:00Z')
    s.push('a', reading('2026-09-21T11:59:00Z'))
    s.push('a', reading('2026-09-21T12:01:00Z'))
    expect(s.prune(now)).toBe(1)
    expect(s.count()).toBe(1)
    expect(new Store().oldestTs()).toBeNull()
  })

  it('survives a restart', () => {
    const path = join(dir, 'gw.db')
    const s = new Store(path)
    s.push('a', reading('2026-09-28T10:00:00Z', 4.2))
    s.saveDevice('a', { id: 'a', profileId: 'sunspec-inverter@3' })
    s.set('batteryFloorPct', 20)
    s.close()
    const again = new Store(path)
    expect(again.peek(1)[0].reading.p_kw).toBe(4.2)
    expect(again.devices()).toEqual([{ id: 'a', profileId: 'sunspec-inverter@3' }])
    expect(again.get('batteryFloorPct')).toBe(20)
    expect(again.get('missing')).toBeNull()
    again.close()
  })
})

describe('pending undos', () => {
  it('keep what the device was before the first command when a second one extends it', () => {
    const s = new Store()
    s.setRevert({ key: 'inv:export_limit', deviceId: 'inv', action: 'export_limit', at: 1000, undo: { reg: 40232, words: [100] } })
    s.setRevert({ key: 'inv:export_limit', deviceId: 'inv', action: 'export_limit', at: 5000, undo: { reg: 40232, words: [60] } })
    expect(s.reverts()).toEqual([{ key: 'inv:export_limit', deviceId: 'inv', action: 'export_limit', at: 5000, undo: { reg: 40232, words: [100] } }])
    s.dropRevert('inv:export_limit')
    expect(s.reverts()).toEqual([])
  })
})
