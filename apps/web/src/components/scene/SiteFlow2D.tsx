import type { FlowKey, SceneFlow, SceneFlows } from "@ecomanage/shared"
import { FLOW_COLOURS } from "./flowColours"

// The scene without WebGL (P4-03): the same flows as a flat diagram. Sources and loads sit around
// the switchboard; a dashed line moves towards it for power coming in and away for power going out.

const SPOTS: Record<FlowKey | "building", { x: number; y: number }> = {
  pv: { x: 50, y: 14 },
  grid: { x: 12, y: 46 },
  battery: { x: 26, y: 82 },
  ev: { x: 74, y: 82 },
  heatpump: { x: 88, y: 46 },
  building: { x: 50, y: 50 },
}
const HUB = SPOTS.building

export function SiteFlow2D({ flows, safeLeft = 0, safeRight = 0 }: { flows: SceneFlows; safeLeft?: number; safeRight?: number }) {
  const keys = (Object.keys(SPOTS) as (FlowKey | "building")[]).filter((k) => k !== "building" && flows[k]) as FlowKey[]
  return (
    <div className="absolute inset-0" style={{ paddingLeft: safeLeft, paddingRight: safeRight }} data-testid="scene-2d">
      <div className="relative h-full w-full">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {keys.map((k) => {
            const f = flows[k] as SceneFlow
            const active = f.dir !== null && f.kw > 0.05
            const { x, y } = SPOTS[k]
            return (
              <line
                key={k}
                x1={x}
                y1={y}
                x2={HUB.x}
                y2={HUB.y}
                stroke={FLOW_COLOURS[k]}
                strokeOpacity={active ? 0.9 : 0.35}
                strokeDasharray={active ? "6 6" : undefined}
                vectorEffect="non-scaling-stroke"
                className={active ? (f.dir === "in" ? "flow-dash" : "flow-dash flow-dash-out") : undefined}
                style={{ strokeWidth: active ? 3 : 1.5 }}
              />
            )
          })}
        </svg>
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-app-tx bg-app-ps"
          style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}
          aria-hidden
        />
        {([...keys, "building"] as (FlowKey | "building")[]).map((k) =>
          flows[k] ? (
            <FlowLabel key={k} k={k} flow={flows[k] as SceneFlow} at={k === "building" ? { x: HUB.x, y: HUB.y - 8 } : SPOTS[k]} />
          ) : null
        )}
      </div>
    </div>
  )
}

function FlowLabel({ k, flow, at }: { k: FlowKey | "building"; flow: SceneFlow; at: { x: number; y: number } }) {
  return (
    <div
      data-testid={`scene-label-${k}`}
      className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-app-ln bg-app-pn px-2.5 py-1.5 backdrop-blur"
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    >
      <div className="flex items-center gap-1.5 text-[11px] tracking-[.02em] text-app-sb">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: FLOW_COLOURS[k] }} />
        {flow.label}
      </div>
      <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-app-tx">
        {flow.kw.toFixed(1)} <span className="text-[11px] font-medium text-app-sb">kW</span>
      </div>
      {flow.sub ? <div className="mt-px text-[11px] text-app-sb">{flow.sub}</div> : null}
    </div>
  )
}
