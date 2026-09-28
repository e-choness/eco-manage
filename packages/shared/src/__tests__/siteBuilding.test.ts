/**
 * P5-03: the generated building, its default device layout and footprints from OpenStreetMap.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUILDING,
  DEFAULT_SITE_MODEL,
  FLOW_KEYS,
  buildingPlan,
  buildingSpecInput,
  footprintArea,
  footprintCrosses,
  layoutAround,
  osmFootprint,
  rectFootprint,
  siteModelInput,
  type BuildingSpec,
  type OsmWay,
  type Point2,
} from '../index'

const spec = (over: Partial<BuildingSpec> = {}): BuildingSpec => ({ ...DEFAULT_BUILDING, ...over })

describe('the default building', () => {
  // The App v2 demo scene (site-scene.js, ported in sceneEngine.ts before P5-03) as numbers.
  it('is the demo building: 7 × 4 × 2.2 m with its window band', () => {
    const plan = buildingPlan(DEFAULT_BUILDING)
    expect(plan.bounds).toEqual({ min: [-3.5, -2.6], max: [3.5, 1.4] })
    expect(plan.height).toBe(2.2)
    expect(plan.windows).toEqual([{ at: [0, 1.35, 1.41], length: 6.2, heading: 0 }])
  })

  it('has the demo roof array: three rows of six panels, tilted 0.1 rad', () => {
    const plan = buildingPlan(DEFAULT_BUILDING)
    const demo = []
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) demo.push([Math.round((-2.75 + i * 1.1) * 100) / 100, 2.3, Math.round((-1.9 + j * 1.15) * 100) / 100])
    const key = (p: number[]) => p.join(',')
    expect(plan.panels.map(key).sort()).toEqual(demo.map(key).sort())
    expect(plan.tiltRad).toBeCloseTo(0.1, 4)
  })

  it('stands on the demo pad at the demo scale', () => {
    const plan = buildingPlan(DEFAULT_BUILDING)
    expect(plan.pad).toEqual({ center: [0, 0], size: [19, 10.5] })
    expect(plan.scale).toBe(1)
  })

  it('places the hub, devices and labels exactly where the demo scene has them', () => {
    const { hub, anchors, buildingLabel } = layoutAround(DEFAULT_BUILDING, FLOW_KEYS)
    expect({ hub, anchors, buildingLabel }).toEqual({ hub: DEFAULT_SITE_MODEL.hub, anchors: DEFAULT_SITE_MODEL.anchors, buildingLabel: DEFAULT_SITE_MODEL.buildingLabel })
    expect(DEFAULT_SITE_MODEL.generated).toBe(DEFAULT_BUILDING)
  })

  it('is what width × depth gives for 7 × 4 m', () => {
    expect(rectFootprint(7, 4)).toEqual(DEFAULT_BUILDING.footprint)
  })
})

describe('buildingPlan', () => {
  it('puts a window band on every storey and grows the scene for a bigger building', () => {
    const plan = buildingPlan(spec({ footprint: rectFootprint(40, 20), storeys: 3, storeyHeightM: 3.5, roofRows: 2 }))
    expect(plan.height).toBe(10.5)
    expect(plan.windows.map((w) => w.at[1])).toEqual([2.65, 6.15, 9.65])
    expect(plan.windows.every((w) => w.length === 39.2)).toBe(true)
    expect(plan.panels).toHaveLength(2 * 36) // (40 − 0.4) / 1.1 → 36 columns
    expect(new Set(plan.panels.map((p) => p[1]))).toEqual(new Set([10.6]))
    expect(plan.scale).toBeCloseTo(52 / 19, 5)
  })

  it('stops at the rows that fit on the roof, and draws none for 0 rows', () => {
    expect(buildingPlan(spec({ roofRows: 10 })).panels).toHaveLength(18)
    expect(buildingPlan(spec({ roofRows: 0 })).panels).toEqual([])
  })

  it('keeps panels inside an L-shaped outline and windows on the walls facing south', () => {
    // An L: the east half is only 2 m deep (south part missing).
    const L: Point2[] = [[-6, -4], [6, -4], [6, -2], [0, -2], [0, 4], [-6, 4]]
    const plan = buildingPlan(spec({ footprint: L, roofRows: 6 }))
    expect(plan.panels.length).toBeGreaterThan(0)
    for (const [x, , z] of plan.panels) expect(x < 0 || z < -2).toBe(true)
    // South-facing walls: the short one at z = −2 (east half) and the long one at z = 4 (west half).
    expect(plan.windows.map((w) => w.at[2]).sort((a, b) => a - b)).toEqual([-1.99, 4.01])
  })

  it('is the same whichever way round the outline runs, and skips walls too short for windows', () => {
    const reversed = [...DEFAULT_BUILDING.footprint].reverse()
    expect(buildingPlan(spec({ footprint: reversed })).windows).toEqual(buildingPlan(DEFAULT_BUILDING).windows)
    // A 0.9 m step in the south wall: no band on it.
    const stepped: Point2[] = [[-5, -3], [5, -3], [5, 2], [0, 2], [0, 2.9], [-5, 2.9]]
    expect(buildingPlan(spec({ footprint: stepped })).windows.map((w) => w.length)).toEqual([4.2, 4.2])
  })

  it('turns the window band with a wall that runs at an angle', () => {
    const tilted: Point2[] = [[0, -5], [5, 0], [0, 5], [-5, 0]] // a diamond: two walls face south
    const plan = buildingPlan(spec({ footprint: tilted }))
    expect(plan.windows.map((w) => Math.abs(w.heading))).toEqual([0.79, 0.79])
  })
})

describe('layoutAround', () => {
  it('moves the devices out with the building and only places the given ones', () => {
    const { hub, anchors } = layoutAround(spec({ footprint: rectFootprint(20, 10) }), ['pv', 'grid'])
    expect(hub).toEqual([0, 0.95, 4])
    expect(anchors.map((a) => a.key)).toEqual(['pv', 'grid'])
    expect(anchors[1].at).toEqual([-13.7, 1.05, -1.5])
  })
})

describe('footprint checks', () => {
  it('measures the area and finds an outline that crosses itself', () => {
    expect(footprintArea(DEFAULT_BUILDING.footprint)).toBe(28)
    expect(footprintCrosses(DEFAULT_BUILDING.footprint)).toBe(false)
    expect(footprintCrosses([[0, 0], [4, 4], [4, 0], [0, 4]])).toBe(true)
  })

  it('accepts the demo building and refuses a bow tie or a sliver', () => {
    expect(buildingSpecInput.safeParse(DEFAULT_BUILDING).success).toBe(true)
    expect(buildingSpecInput.safeParse(spec({ footprint: [[0, 0], [4, 4], [4, 0], [0, 4]] })).error?.issues[0].message).toBe('The outline crosses itself')
    expect(buildingSpecInput.safeParse(spec({ footprint: [[0, 0], [10, 0], [10, 0.2]] })).error?.issues[0].message).toMatch(/at least 4 m²/)
    expect(buildingSpecInput.safeParse(spec({ storeys: 0 })).success).toBe(false)
  })

  it('is optional in a site model save', () => {
    const base = { hub: DEFAULT_SITE_MODEL.hub, anchors: DEFAULT_SITE_MODEL.anchors, buildingLabel: DEFAULT_SITE_MODEL.buildingLabel, camera: { view: 'fit' as const } }
    expect(siteModelInput.safeParse(base).success).toBe(true)
    expect(siteModelInput.safeParse({ ...base, generated: DEFAULT_BUILDING }).success).toBe(true)
  })
})

describe('osmFootprint', () => {
  const at = { lat: 45.5, lon: -73.6 }
  // A 30 × 20 m building (east–west × north–south) centred 10 m east of the point, with a
  // redundant corner in the middle of its north wall.
  const mLon = 111_320 * Math.cos((45.5 * Math.PI) / 180)
  const mLat = 110_574
  const ll = (x: number, z: number) => ({ lat: at.lat - z / mLat, lon: at.lon + x / mLon })
  const school: OsmWay = {
    type: 'way',
    id: 123,
    tags: { building: 'school', name: 'Maple Grove School', 'building:levels': '2' },
    geometry: [ll(-5, -10), ll(10, -10), ll(25, -10), ll(25, 10), ll(-5, 10), ll(-5, -10)],
  }
  const shed: OsmWay = { type: 'way', id: 7, tags: { building: 'shed' }, geometry: [ll(40, 30), ll(44, 30), ll(44, 33), ll(40, 33), ll(40, 30)] }

  it('takes the building under the point, centred, with its storeys and name', () => {
    const f = osmFootprint([shed, school], at)!
    expect(f).toMatchObject({ wayId: 123, name: 'Maple Grove School', storeys: 2 })
    expect(f.footprint).toHaveLength(4) // the straight-through corner is dropped
    expect(footprintArea(f.footprint)).toBeCloseTo(600, 0)
    const xs = f.footprint.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(-15, 1)
    expect(Math.max(...xs)).toBeCloseTo(15, 1)
  })

  it('falls back to the nearest building close by, and finds nothing further away', () => {
    expect(osmFootprint([shed], at)?.wayId).toBe(7)
    const nearer: OsmWay = { type: 'way', id: 11, tags: { building: 'shed' }, geometry: [ll(10, 10), ll(14, 10), ll(14, 13), ll(10, 13), ll(10, 10)] }
    expect(osmFootprint([shed, nearer], at)?.wayId).toBe(11)
    const far: OsmWay = { ...shed, geometry: shed.geometry!.map((p) => ({ lat: p.lat - 0.01, lon: p.lon })) }
    expect(osmFootprint([far], at)).toBeNull()
    expect(osmFootprint([{ type: 'way', id: 9, tags: { highway: 'road' }, geometry: school.geometry }], at)).toBeNull()
  })

  it('takes an outline that isn’t closed, and skips ways without one or too small to be a building', () => {
    const open: OsmWay = { ...school, geometry: school.geometry!.slice(0, -1) }
    expect(osmFootprint([open], at)?.footprint).toHaveLength(4)
    const kiosk: OsmWay = { type: 'way', id: 8, tags: { building: 'kiosk' }, geometry: [ll(0, 0), ll(1, 0), ll(1, 1), ll(0, 1), ll(0, 0)].map((p) => ({ lat: p.lat - 0.5 / 110_574, lon: p.lon - 0.5 / mLon })) }
    expect(osmFootprint([kiosk, { type: 'way', id: 9, tags: { building: 'yes' } }], at)).toBeNull()
  })

  it('ignores a storey count it cannot read', () => {
    expect(osmFootprint([{ ...school, tags: { building: 'yes', 'building:levels': 'two' } }], at)?.storeys).toBeNull()
  })
})
