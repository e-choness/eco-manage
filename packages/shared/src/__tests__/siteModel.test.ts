/**
 * P4-03: what Home's scene draws for each anchor, from the live snapshot.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_MODEL, FLOW_KEYS, sceneFlows, siteModelInput, type SiteSnapshot } from '../index'

type Dev = SiteSnapshot['devices'][number]
const dev = (id: string, type: Dev['type'], over: Partial<Dev> = {}): Dev => ({
  id, name: id, type, status: 'live', profileId: null, ratedKw: null, capacityKwh: null, lastSeenAt: null, latest: null, ...over,
})
const reading = (p_kw: number) => ({ ts: '2026-09-24T16:40:00Z', p_kw, q: 'ok' as const })

const maple = {
  devices: [
    dev('invA', 'pv', { ratedKw: 50 }),
    dev('invB', 'pv', { ratedKw: 36.4 }),
    dev('bat', 'battery'),
    dev('meter', 'meter'),
    dev('ev1', 'ev', { latest: reading(-7.4) }),
    dev('ev2', 'ev', { latest: reading(-7.2) }),
    dev('ev3', 'ev', { status: 'stale' }),
    dev('ev4', 'ev'), // live, no reading yet
    dev('hp', 'heatpump'),
  ],
  flows: { pv: 61.43, battery: 20, grid: 12.8, ev: -14.6, heatpump: -18, building: 61.6, stale: ['ev3'] },
  battery: { socPct: 67.6, reservePct: 20, usableKwh: 200, pKw: 20, minutesLeft: 290 },
}

describe('DEFAULT_SITE_MODEL', () => {
  it('has one anchor per flow, as in the App v2 scene', () => {
    expect(DEFAULT_SITE_MODEL.anchors.map((a) => a.key)).toEqual([...FLOW_KEYS])
  })
})

describe('sceneFlows', () => {
  it('turns the snapshot into App v2 labels, sources in and loads out', () => {
    expect(sceneFlows(maple)).toEqual({
      pv: { label: 'Solar', kw: 61.4, dir: 'in', sub: '86 kW rated' },
      battery: { label: 'Battery', kw: 20, dir: 'in', sub: '68% · discharging', soc: 68 },
      grid: { label: 'Grid', kw: 12.8, dir: 'in', sub: 'importing' },
      ev: { label: 'EV chargers', kw: 14.6, dir: 'out', sub: '2 charging · 1 no data' },
      heatpump: { label: 'Heat pump', kw: 18, dir: 'out', sub: 'running' },
      building: { label: 'Building', kw: 61.6, dir: null, sub: 'calculated remainder' },
    })
  })

  it('covers charging, exporting, idle and missing readings', () => {
    const f = sceneFlows({
      ...maple,
      devices: maple.devices.map((d) => (d.type === 'pv' ? { ...d, ratedKw: null } : d.type === 'ev' ? { ...d, latest: reading(0), status: 'live' as const } : d)),
      flows: { ...maple.flows, battery: -30, grid: -5, heatpump: 0, ev: 0, building: null },
      battery: { ...maple.battery, socPct: null },
    })
    expect(f.pv?.sub).toBe('solar')
    expect(f.battery).toEqual({ label: 'Battery', kw: 30, dir: 'out', sub: 'no reading · charging', soc: null })
    expect(f.grid?.sub).toBe('exporting')
    expect(f.ev).toMatchObject({ dir: null, sub: 'idle' })
    expect(f.heatpump).toMatchObject({ dir: null, sub: 'off' })
    expect(f.building).toBeNull()
    const quiet = sceneFlows({ ...maple, flows: { ...maple.flows, battery: 0, grid: 0.01 } })
    expect(quiet.battery?.sub).toBe('68% · idle')
    expect(quiet.grid?.sub).toBe('balanced')
    expect(sceneFlows({ ...maple, flows: { ...maple.flows, grid: null } }).grid).toEqual({ label: 'Grid', kw: 0, dir: null, sub: 'no reading' })
  })

  it('leaves out what the site does not have', () => {
    const f = sceneFlows({ ...maple, devices: [dev('meter', 'meter')] })
    expect([f.pv, f.battery, f.ev, f.heatpump]).toEqual([null, null, null, null])
    expect(f.grid).not.toBeNull()
    expect(sceneFlows({ ...maple, devices: [] }).grid).toBeNull()
  })
})

describe('siteModelInput', () => {
  const input = { hub: [0, 1, 2], anchors: DEFAULT_SITE_MODEL.anchors, buildingLabel: [0, 3, 0], camera: { view: 'iso' } }

  it('takes an edited model', () => {
    expect(siteModelInput.parse(input).anchors).toHaveLength(5)
  })

  it('refuses two anchors for one source, and positions off the site', () => {
    expect(siteModelInput.safeParse({ ...input, anchors: [DEFAULT_SITE_MODEL.anchors[0], DEFAULT_SITE_MODEL.anchors[0]] }).success).toBe(false)
    expect(siteModelInput.safeParse({ ...input, hub: [0, 1, 9999] }).success).toBe(false)
  })
})
