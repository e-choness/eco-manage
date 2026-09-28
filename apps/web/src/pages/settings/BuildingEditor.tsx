import { useMemo, useState } from "react"
import { boundsOf, buildingPlan, buildingSpecInput, layoutAround, rectFootprint, type BuildingSpec, type FlowKey, type Point2, type SiteModelAnchor, type Vec3 } from "@ecomanage/shared"
import { getOsmFootprint } from "@/api/settings"
import { FLOW_COLOURS } from "@/components/scene/flowColours"
import { cn } from "@/lib/utils"
import { Field, NumberInput } from "./ui"

// Settings → Site model → Generate from settings (P5-03, Data and Device Audit §6): the building's
// outline from width × depth or from OpenStreetMap, its storeys and roof array rows. A top-down plan
// shows the result before it goes into the draft.

type Outline = { footprint: Point2[]; osm: BuildingSpec["osm"] }

interface Props {
  spec: BuildingSpec
  anchorKeys: FlowKey[]
  canEdit: boolean
  apply: (spec: BuildingSpec, placeDevices: boolean) => void
}

const size = (pts: Point2[]) => {
  const { min, max } = boundsOf(pts)
  return { width: Math.round((max[0] - min[0]) * 10) / 10, depth: Math.round((max[1] - min[1]) * 10) / 10 }
}

/** Whether the outline is what width × depth gives (anything else is kept as drawn). */
const isRect = (pts: Point2[]) => {
  const { width, depth } = size(pts)
  return JSON.stringify(pts) === JSON.stringify(rectFootprint(width, depth))
}

type Mode = "size" | "osm" | "keep"

export function BuildingEditor({ spec, anchorKeys, canEdit, apply }: Props) {
  const initial: Mode = spec.osm ? "osm" : isRect(spec.footprint) ? "size" : "keep"
  const [mode, setMode] = useState<Mode>(initial)
  const [dims, setDims] = useState<{ width: number | null; depth: number | null }>(() => size(spec.footprint))
  const [traced, setTraced] = useState<Outline | null>(spec.osm ? { footprint: spec.footprint, osm: spec.osm } : null)
  const [storeys, setStoreys] = useState<number | null>(spec.storeys)
  const [storeyHeightM, setStoreyHeight] = useState<number | null>(spec.storeyHeightM)
  const [roofRows, setRoofRows] = useState<number | null>(spec.roofRows)
  const [arrayTiltDeg, setTilt] = useState<number | null>(spec.arrayTiltDeg)
  const [placeDevices, setPlaceDevices] = useState(true)
  const [lookup, setLookup] = useState<{ busy: boolean; problem: string | null }>({ busy: false, problem: null })

  const outline: Outline | null =
    mode === "keep" ? { footprint: spec.footprint, osm: null } : mode === "osm" ? traced : dims.width && dims.depth && dims.width > 0 && dims.depth > 0 ? { footprint: rectFootprint(dims.width, dims.depth), osm: null } : null
  const candidate = outline ? { ...outline, storeys, storeyHeightM, roofRows, arrayTiltDeg } : null
  const parsed = candidate ? buildingSpecInput.safeParse(candidate) : null
  const next: BuildingSpec | null = parsed?.success ? parsed.data : null
  const problem = !outline ? (mode === "osm" ? "Pull the outline from OpenStreetMap first." : "Enter the width and depth.") : parsed && !parsed.success ? parsed.error.issues[0].message : null
  const unchanged = next != null && JSON.stringify(next) === JSON.stringify(spec)

  const pull = async () => {
    setLookup({ busy: true, problem: null })
    try {
      const found = await getOsmFootprint()
      setTraced({ footprint: found.footprint, osm: { wayId: found.wayId, name: found.name } })
      if (found.storeys) setStoreys(found.storeys)
      setLookup({ busy: false, problem: null })
    } catch (err) {
      setLookup({ busy: false, problem: err instanceof Error ? err.message : "OpenStreetMap couldn’t be reached." })
    }
  }

  const num = (label: string, value: number | null, set: (v: number | null) => void, suffix?: string, step = "any") => (
    <Field label={label} suffix={suffix}>
      <NumberInput label={label} value={value} set={set} step={step} disabled={!canEdit} />
    </Field>
  )

  return (
    <section aria-label="Building" className="flex flex-col gap-3 rounded-[14px] border border-app-l2 bg-app-ps p-4">
      <h2 className="m-0 text-sm font-semibold">Building</h2>
      <div role="radiogroup" aria-label="Outline" className="flex flex-wrap gap-1.5">
        {(
          [
            ...(initial === "keep" ? [["keep", "Current outline"] as const] : []),
            ["size", "Width × depth"],
            ["osm", "From OpenStreetMap"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={!canEdit}
            onClick={() => setMode(value)}
            className={cn("whitespace-nowrap rounded-md border px-2.5 py-1 text-xs disabled:cursor-default", mode === value ? "border-[rgba(62,207,142,.5)] bg-app-ch text-app-tx" : "border-app-ln text-app-sb")}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "keep" ? (
        <p className="m-0 text-[13px] text-app-sb">
          {size(spec.footprint).width} × {size(spec.footprint).depth} m, {spec.footprint.length} corners, kept as it is.
        </p>
      ) : mode === "size" ? (
        <div className="grid grid-cols-2 gap-2.5">
          {num("Width (east–west)", dims.width, (width) => setDims({ ...dims, width }), "m")}
          {num("Depth (north–south)", dims.depth, (depth) => setDims({ ...dims, depth }), "m")}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {traced?.osm ? (
            <p className="m-0 text-app-sb" data-testid="osm-outline">
              {traced.osm.name ?? "Building"} · {size(traced.footprint).width} × {size(traced.footprint).depth} m, {traced.footprint.length} corners
            </p>
          ) : (
            <p className="m-0 text-app-dm">Finds the building at the site’s location (Settings → Site).</p>
          )}
          {canEdit ? (
            <button type="button" onClick={() => void pull()} disabled={lookup.busy} className="self-start p-0 text-xs text-tag-grid disabled:text-app-dm">
              {lookup.busy ? "Looking it up…" : traced ? "Pull again" : "Pull from OpenStreetMap"}
            </button>
          ) : null}
          {lookup.problem ? (
            <p role="alert" className="m-0 text-xs text-tag-hp">
              {lookup.problem}
            </p>
          ) : null}
          <OsmCredit />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {num("Storeys", storeys, setStoreys, undefined, "1")}
        {num("Storey height", storeyHeightM, setStoreyHeight, "m")}
        {num("Roof array rows", roofRows, setRoofRows, undefined, "1")}
        {num("Panel tilt", arrayTiltDeg, setTilt, "°")}
      </div>
      {next ? <PlanView spec={next} anchors={placeDevices ? layoutAround(next, anchorKeys) : null} /> : null}
      {problem ? <p className="m-0 text-xs text-app-dm">{problem}</p> : null}
      {canEdit ? (
        <>
          <label className="flex items-center gap-2 text-[13px] text-app-sb">
            <input type="checkbox" checked={placeDevices} onChange={(e) => setPlaceDevices(e.target.checked)} />
            Place the devices around the building
          </label>
          <button
            type="button"
            disabled={!next || unchanged}
            onClick={() => next && apply(next, placeDevices)}
            className="self-start rounded-lg border border-app-ln px-3 py-1.5 text-[13px] text-app-tx disabled:text-app-dm"
          >
            Apply to the model
          </button>
        </>
      ) : null}
    </section>
  )
}

/** OpenStreetMap data is under the ODbL: shown wherever an outline from it is used. */
export function OsmCredit({ className }: { className?: string }) {
  return (
    <span className={cn("text-[11px] text-app-dm", className)}>
      Outline ©{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-app-sb underline">
        OpenStreetMap contributors
      </a>
    </span>
  )
}

/** Top-down: north up, the paved area, the outline, the panels, the hub and each device. */
function PlanView({ spec, anchors }: { spec: BuildingSpec; anchors: { hub: Vec3; anchors: SiteModelAnchor[] } | null }) {
  const plan = useMemo(() => buildingPlan(spec), [spec])
  const [cx, cz] = plan.pad.center
  const [w, d] = plan.pad.size
  const dot = Math.max(w, d) / 60
  const { width, depth } = size(spec.footprint)
  return (
    <figure className="m-0 flex flex-col gap-1">
      <svg
        role="img"
        aria-label={`Top-down plan: ${width} × ${depth} m, ${spec.storeys} ${spec.storeys === 1 ? "storey" : "storeys"}, ${plan.panels.length} panels`}
        viewBox={`${cx - w / 2} ${cz - d / 2} ${w} ${d}`}
        className="h-40 w-full rounded-lg bg-app-bg"
      >
        <polygon points={spec.footprint.map((p) => p.join(",")).join(" ")} fill="var(--pn)" stroke="var(--sb)" strokeWidth={dot / 3} />
        {plan.panels.map(([x, , z], i) => (
          <rect key={i} x={x - 0.49} y={z - 0.51} width={0.98} height={1.02} fill={FLOW_COLOURS.pv} opacity={0.55} />
        ))}
        {anchors ? (
          <>
            {anchors.anchors.map((a) => (
              <circle key={a.key} cx={a.at[0]} cy={a.at[2]} r={dot} fill={FLOW_COLOURS[a.key]} />
            ))}
            <circle cx={anchors.hub[0]} cy={anchors.hub[2]} r={dot} fill="none" stroke="var(--tx)" strokeWidth={dot / 3} />
          </>
        ) : null}
      </svg>
      <figcaption className="text-xs text-app-dm">
        {width} × {depth} m · {plan.panels.length} panels{anchors ? " · devices placed around it (ring: switchboard)" : ""}
      </figcaption>
    </figure>
  )
}
