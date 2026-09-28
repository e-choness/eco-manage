import { z } from 'zod';
import type { FlowKey, SiteModelAnchor, Vec3 } from './siteModel';

// The generated site model (P5-03, Data and Device Audit §6 "A · Default"): the building comes from
// its footprint (width × depth, or an outline pulled from OpenStreetMap), storeys and roof array
// rows, and is drawn from simple shapes as in the App v2 demo. Pure, so the scene, the top-down plan
// in Settings and the tests share it. Scene metres: x east, y up, z south (north is −z).

export type Point2 = [number, number]; // [x, z]

export interface BuildingSpec {
  footprint: Point2[]; // the outline's corners in order (not closed)
  storeys: number;
  storeyHeightM: number;
  roofRows: number; // rows of panels on the roof, from the north edge; 0 for none
  arrayTiltDeg: number; // the panels lean towards the south (+z)
  osm: { wayId: number; name: string | null } | null; // when the outline came from OpenStreetMap
}

/** The App v2 demo building (Maple Grove School): 7 × 4 m, one 2.2 m storey, three rows of six panels. */
export const DEFAULT_BUILDING: BuildingSpec = {
  footprint: [
    [-3.5, -2.6],
    [3.5, -2.6],
    [3.5, 1.4],
    [-3.5, 1.4],
  ],
  storeys: 1,
  storeyHeightM: 2.2,
  roofRows: 3,
  arrayTiltDeg: 5.73, // the demo's 0.1 rad
  osm: null,
};

// Panels as the demo draws them: 0.98 × 1.02 m on a 1.1 × 1.15 m grid, 0.1 m above the roof, the
// first row 0.7 m from the north edge.
const PANEL = { w: 0.98, d: 1.02, pitchX: 1.1, pitchZ: 1.15, lift: 0.1, edge: 0.2, firstRow: 0.7, clear: 0.1 };
const WINDOW = { inset: 0.8, belowTop: 0.85, min: 0.6 };
// The paved area around the building, and the ~19 × 10.5 m site the camera and shadows are set for.
const PAD = { west: 6, east: 6, north: 2.65, south: 3.85 };
const DEMO_PAD: Point2 = [19, 10.5];

const r2 = (x: number) => Math.round(x * 100) / 100 + 0; // + 0 turns −0 into 0
const v3 = (x: number, y: number, z: number): Vec3 => [r2(x), r2(y), r2(z)];

/** A width × depth outline, set back a little so the hub and devices in front stay in view. */
export const rectFootprint = (width: number, depth: number): Point2[] => {
  const [w, n, s] = [width / 2, -0.65 * depth, 0.35 * depth];
  return [
    [r2(-w), r2(n)],
    [r2(w), r2(n)],
    [r2(w), r2(s)],
    [r2(-w), r2(s)],
  ];
};

export const boundsOf = (pts: Point2[]): { min: Point2; max: Point2 } => ({
  min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
  max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
});

/** Signed area (positive when the corners run clockwise seen from above, i.e. x east, z south). */
const signedArea = (pts: Point2[]) => pts.reduce((sum, [x1, z1], i) => {
  const [x2, z2] = pts[(i + 1) % pts.length];
  return sum + (x1 * z2 - x2 * z1) / 2;
}, 0);

export const footprintArea = (pts: Point2[]): number => Math.abs(signedArea(pts));

/** Whether [x, z] is inside the outline (even–odd rule). */
export const insideFootprint = (pts: Point2[], [x, z]: Point2): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const segmentsCross = (a: Point2, b: Point2, c: Point2, d: Point2) => {
  const o = (p: Point2, q: Point2, r: Point2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/** Whether two edges that don't share a corner cross (the outline must be a simple polygon). */
export const footprintCrosses = (pts: Point2[]): boolean => {
  const n = pts.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  return false;
};

export interface BuildingPlan {
  footprint: Point2[];
  height: number;
  /** A band of windows per storey on each wall facing south (the demo's front). */
  windows: { at: Vec3; length: number; heading: number }[];
  panels: Vec3[]; // panel centres
  tiltRad: number;
  pad: { center: Point2; size: Point2 };
  bounds: { min: Point2; max: Point2 };
  /** How much bigger than the demo site the scene is (camera, shadows and fog scale by it); ≥ 1. */
  scale: number;
}

/** What the scene draws for a building spec. */
export const buildingPlan = (spec: BuildingSpec): BuildingPlan => {
  const pts = spec.footprint;
  const height = r2(spec.storeys * spec.storeyHeightM);
  const bounds = boundsOf(pts);
  const [[minX, minZ], [maxX, maxZ]] = [bounds.min, bounds.max];

  const windows: BuildingPlan['windows'] = [];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len - WINDOW.inset < WINDOW.min) continue;
    const [dx, dz] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const mid: Point2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // The outward normal is the one that leaves the outline.
    let [nx, nz] = [dz, -dx];
    if (insideFootprint(pts, [mid[0] + nx * 0.05, mid[1] + nz * 0.05])) [nx, nz] = [-nx, -nz];
    if (nz < 0.5) continue; // not facing south
    let heading = Math.atan2(-dz, dx);
    while (heading > Math.PI / 2) heading -= Math.PI;
    while (heading <= -Math.PI / 2) heading += Math.PI;
    for (let s = 0; s < spec.storeys; s++) {
      const y = (s + 1) * spec.storeyHeightM - WINDOW.belowTop;
      windows.push({ at: v3(mid[0] + nx * 0.01, y, mid[1] + nz * 0.01), length: r2(len - WINDOW.inset), heading: r2(heading) });
    }
  }

  // Panels on a grid centred across the roof, rows from the north edge; a panel is kept when it
  // fits inside the outline with a little room to spare.
  const panels: Vec3[] = [];
  const cols = Math.floor((maxX - minX - 2 * PANEL.edge) / PANEL.pitchX + 1e-9);
  const x0 = (minX + maxX) / 2 - ((cols - 1) * PANEL.pitchX) / 2;
  const [hw, hd] = [PANEL.w / 2 + PANEL.clear, PANEL.d / 2 + PANEL.clear];
  let rows = 0;
  for (let z = minZ + PANEL.firstRow; rows < spec.roofRows && z + PANEL.d / 2 <= maxZ; z += PANEL.pitchZ) {
    const row: Vec3[] = [];
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * PANEL.pitchX;
      const corners: Point2[] = [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]];
      if (corners.every((p) => insideFootprint(pts, p))) row.push(v3(x, height + PANEL.lift, z));
    }
    if (row.length) {
      panels.push(...row);
      rows++;
    }
  }

  const padMin: Point2 = [minX - PAD.west, minZ - PAD.north];
  const padMax: Point2 = [maxX + PAD.east, maxZ + PAD.south];
  const size: Point2 = [r2(padMax[0] - padMin[0]), r2(padMax[1] - padMin[1])];
  return {
    footprint: pts,
    height,
    windows,
    panels,
    tiltRad: (spec.arrayTiltDeg * Math.PI) / 180,
    pad: { center: [r2((padMin[0] + padMax[0]) / 2), r2((padMin[1] + padMax[1]) / 2)], size },
    bounds,
    scale: Math.max(1, size[0] / DEMO_PAD[0], size[1] / DEMO_PAD[1], (height * 2) / DEMO_PAD[0]),
  };
};

/**
 * Where the hub, each device and the labels go around a building, as in the demo: the switchboard
 * in front, battery and grid connection to the west, EV chargers and heat pump to the east, solar
 * on the roof. The installer moves them from there. `keys` are the sources and loads to place.
 */
export const layoutAround = (spec: BuildingSpec, keys: readonly FlowKey[]): { hub: Vec3; anchors: SiteModelAnchor[]; buildingLabel: Vec3 } => {
  const { bounds, height: h } = buildingPlan(spec);
  const [[minX, minZ], [maxX, maxZ]] = [bounds.min, bounds.max];
  const [cx, cz] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const all: Record<FlowKey, Omit<SiteModelAnchor, 'key'>> = {
    pv: { at: v3(cx, h + 0.25, cz + 0.2), label: v3(cx + 2.6, h + 1, cz - 1) },
    battery: { at: v3(minX - 1.5, 1.05, maxZ + 1), label: v3(minX - 1.5, 2, maxZ + 1) },
    grid: { at: v3(minX - 3.7, 1.05, cz), label: v3(minX - 4.1, 2.5, cz) },
    ev: { at: v3(maxX + 0.9, 1, maxZ + 1.2), label: v3(maxX + 2.1, 2, maxZ + 1.8) },
    heatpump: { at: v3(maxX + 2.1, 0.95, cz - 0.3), label: v3(maxX + 2.7, 2, cz - 0.3) },
  };
  return {
    hub: v3(cx, 0.95, maxZ + 0.5),
    anchors: keys.map((key) => ({ key, ...all[key] })),
    buildingLabel: v3(minX + 0.5, h + 0.9, minZ),
  };
};

// ---- OpenStreetMap -------------------------------------------------------------------------------

/** A way from the Overpass API (`out tags geom`). */
export interface OsmWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export interface OsmFootprint {
  footprint: Point2[];
  storeys: number | null; // from building:levels
  wayId: number;
  name: string | null;
}

/** GET /api/site/model/osm-footprint: the outline found, the point searched and the credit to show. */
export interface OsmFootprintView extends OsmFootprint {
  at: { lat: number; lon: number };
  attribution: string;
}

export const OSM_MAX_CORNERS = 64;
export const OSM_SEARCH_M = 60;
// OpenStreetMap data is under the ODbL: anything drawn from it credits the contributors.
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Drops corners closer than 0.3 m to the previous one, then the flattest corners down to `max`. */
const simplify = (pts: Point2[], max: number): Point2[] => {
  let out = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) >= 0.3);
  const cornerArea = (i: number) => {
    const [a, b, c] = [out[(i - 1 + out.length) % out.length], out[i], out[(i + 1) % out.length]];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  };
  while (out.length > 3) {
    let flattest = 0;
    for (let i = 1; i < out.length; i++) if (cornerArea(i) < cornerArea(flattest)) flattest = i;
    // Straight-through corners go whatever the count; others only while there are too many.
    if (cornerArea(flattest) > 0.05 && out.length <= max) break;
    out = out.filter((_, i) => i !== flattest);
  }
  return out;
};

/**
 * The building at a point, from Overpass ways tagged `building`: the one containing the point, else
 * the nearest within OSM_SEARCH_M. Its outline in scene metres, centred on the building.
 */
export const osmFootprint = (ways: OsmWay[], at: { lat: number; lon: number }): OsmFootprint | null => {
  const mPerLat = 110_574;
  const mPerLon = 111_320 * Math.cos((at.lat * Math.PI) / 180);
  const candidates = ways
    .filter((w) => w.type === 'way' && w.tags?.building && (w.geometry?.length ?? 0) >= 4)
    .map((w) => {
      const g = w.geometry!;
      const closed = g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
      const pts: Point2[] = (closed ? g.slice(0, -1) : g).map((p) => [(p.lon - at.lon) * mPerLon, -(p.lat - at.lat) * mPerLat]);
      const area = signedArea(pts);
      const [cx, cz] = pts.reduce(([sx, sz], [x1, z1], i) => {
        const [x2, z2] = pts[(i + 1) % pts.length];
        const f = x1 * z2 - x2 * z1;
        return [sx + ((x1 + x2) * f) / (6 * area), sz + ((z1 + z2) * f) / (6 * area)];
      }, [0, 0]);
      return { w, pts, centre: [cx, cz] as Point2, inside: insideFootprint(pts, [0, 0]), dist: Math.hypot(cx, cz) };
    })
    .filter((c) => Math.abs(signedArea(c.pts)) >= 4 && (c.inside || c.dist <= OSM_SEARCH_M))
    .sort((a, b) => Number(b.inside) - Number(a.inside) || a.dist - b.dist);
  const best = candidates[0];
  if (!best) return null;
  const centred = simplify(best.pts.map(([x, z]): Point2 => [x - best.centre[0], z - best.centre[1]]), OSM_MAX_CORNERS);
  const levels = Number.parseInt(best.w.tags?.['building:levels'] ?? '', 10);
  return {
    footprint: centred.map(([x, z]): Point2 => [r2(x), r2(z)]),
    storeys: Number.isFinite(levels) && levels >= 1 ? Math.min(levels, 30) : null,
    wayId: best.w.id,
    name: best.w.tags?.name ?? null,
  };
};

// ---- input ---------------------------------------------------------------------------------------

const coord = z.number().finite().min(-250).max(250);

/** The building in PUT /api/site/model (owner, installer). */
export const buildingSpecInput = z
  .object({
    footprint: z.array(z.tuple([coord, coord])).min(3).max(OSM_MAX_CORNERS),
    storeys: z.number().int().min(1).max(30),
    storeyHeightM: z.number().finite().min(2).max(6),
    roofRows: z.number().int().min(0).max(60),
    arrayTiltDeg: z.number().finite().min(0).max(45),
    osm: z.object({ wayId: z.number().int().positive(), name: z.string().max(200).nullable() }).strict().nullable(),
  })
  .strict()
  .refine((b) => !footprintCrosses(b.footprint), { message: 'The outline crosses itself', path: ['footprint'] })
  .refine((b) => footprintArea(b.footprint) >= 4, { message: 'The building needs an outline of at least 4 m²', path: ['footprint'] });
