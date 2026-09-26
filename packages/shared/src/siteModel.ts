import type { SiteSnapshot } from './api/site';

// The 3D site model (plan §2 `siteModels`, P4-03). Home draws the site from it: where the
// building's hub is, where each energy source or load sits (its anchor, where its flow starts) and
// where its label floats. Until a site has a generated or uploaded model (P4-08, P5-02/03), it
// uses the App v2 demo scene below. Units are scene metres; y is up.

export const FLOW_KEYS = ['pv', 'battery', 'grid', 'ev', 'heatpump'] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];
export type Vec3 = [number, number, number];

export const SCENE_VIEWS = ['iso', 'wide', 'far', 'farther', 'fit', 'side'] as const;
export type SceneView = (typeof SCENE_VIEWS)[number];

export interface SiteModelAnchor {
  key: FlowKey;
  at: Vec3; // where the flow starts
  label: Vec3; // where the label floats
}

export interface SiteModel {
  version: number; // 0: the default model, nothing saved yet
  source: 'default' | 'generated' | 'upload';
  hub: Vec3; // where every flow meets (the main switchboard)
  anchors: SiteModelAnchor[];
  buildingLabel: Vec3;
  camera: { view: SceneView };
}

/** The App v2 demo scene (site-scene.js): Maple Grove School. */
export const DEFAULT_SITE_MODEL: SiteModel = {
  version: 0,
  source: 'default',
  hub: [0, 0.95, 1.9],
  anchors: [
    { key: 'pv', at: [0, 2.45, -0.4], label: [2.6, 3.2, -1.6] },
    { key: 'battery', at: [-5, 1.05, 2.4], label: [-5, 2.0, 2.4] },
    { key: 'grid', at: [-7.2, 1.05, -0.6], label: [-7.6, 2.5, -0.6] },
    { key: 'ev', at: [4.4, 1.0, 2.6], label: [5.6, 2.0, 3.2] },
    { key: 'heatpump', at: [5.6, 0.95, -0.9], label: [6.2, 2.0, -0.9] },
  ],
  buildingLabel: [-3.0, 3.1, -2.6],
  camera: { view: 'fit' },
};

/** One flow as the scene and its 2D fallback show it. */
export interface SceneFlow {
  label: string;
  kw: number; // size, always ≥ 0
  dir: 'in' | 'out' | null; // into the switchboard (sources) or out (loads); null when ~0
  sub: string;
  soc?: number | null;
}

export type SceneFlows = Record<FlowKey, SceneFlow | null> & { building: SceneFlow | null };

const IDLE_KW = 0.05;
const round1 = (x: number) => Math.round(x * 10) / 10;
const dirOf = (kw: number): SceneFlow['dir'] => (Math.abs(kw) < IDLE_KW ? null : kw > 0 ? 'in' : 'out');

/**
 * Snapshot flows (site sign convention: into the switchboard positive) as scene flows. A source or
 * load the site doesn't have is null, so its anchor draws nothing.
 */
export const sceneFlows = (s: Pick<SiteSnapshot, 'flows' | 'battery' | 'devices'>): SceneFlows => {
  const of = (type: string) => s.devices.filter((d) => d.type === type);
  const flow = (label: string, kw: number, sub: string, extra: Partial<SceneFlow> = {}): SceneFlow => ({ label, kw: round1(Math.abs(kw)), dir: dirOf(kw), sub, ...extra });

  const pv = of('pv');
  const rated = pv.reduce((sum, d) => sum + (d.ratedKw ?? 0), 0);
  const evs = of('ev');
  const charging = evs.filter((d) => d.status === 'live' && Math.abs(d.latest?.p_kw ?? 0) > 0.1).length;
  const noData = evs.filter((d) => d.status !== 'live').length;
  const soc = s.battery.socPct;
  const bat = s.flows.battery;
  const grid = s.flows.grid;

  return {
    pv: pv.length ? flow('Solar', s.flows.pv, rated ? `${Math.round(rated)} kW rated` : 'solar') : null,
    battery: of('battery').length
      ? flow('Battery', bat, `${soc == null ? 'no reading' : `${Math.round(soc)}%`} · ${bat > IDLE_KW ? 'discharging' : bat < -IDLE_KW ? 'charging' : 'idle'}`, {
          soc: soc == null ? null : Math.round(soc),
        })
      : null,
    grid: of('meter').length
      ? grid == null
        ? { label: 'Grid', kw: 0, dir: null, sub: 'no reading' }
        : flow('Grid', grid, grid > IDLE_KW ? 'importing' : grid < -IDLE_KW ? 'exporting' : 'balanced')
      : null,
    ev: evs.length ? flow('EV chargers', s.flows.ev, [charging ? `${charging} charging` : 'idle', noData ? `${noData} no data` : ''].filter(Boolean).join(' · ')) : null,
    heatpump: of('heatpump').length ? flow('Heat pump', s.flows.heatpump, Math.abs(s.flows.heatpump) > IDLE_KW ? 'running' : 'off') : null,
    building: s.flows.building == null ? null : { label: 'Building', kw: round1(s.flows.building), dir: null, sub: 'calculated remainder' },
  };
};
