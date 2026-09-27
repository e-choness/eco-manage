import { useMemo, useState } from "react"
import { DEFAULT_SITE_MODEL, FLOW_KEYS, sceneFlows, type FlowKey, type SiteModel, type SiteModelInput, type SiteSnapshot, type Vec3 } from "@ecomanage/shared"
import { SiteScene } from "@/components/scene/SiteScene"
import { hasWebGL } from "@/components/scene/sceneEngine"
import { useTheme } from "@/components/ui/theme-provider"
import { cn } from "@/lib/utils"
import { ReadOnly } from "./ui"

const NAME: Record<FlowKey | "hub", string> = { hub: "Switchboard (hub)", pv: "Solar", battery: "Battery", grid: "Grid connection", ev: "EV chargers", heatpump: "Heat pump" }
const LABEL_LIFT = 1.2 // labels float this far above their anchor
const fmt = (v: Vec3) => v.map((x) => x.toFixed(1)).join(", ")

interface Props {
  draft: SiteModelInput | null
  set: (m: SiteModelInput) => void
  saved: SiteModel | undefined
  snap: SiteSnapshot | undefined
  canEdit: boolean
}

/**
 * Settings → Site model (App v2): the scene Home draws, and where each source and load sits on it.
 * Choose "Move", then click the model where that device is.
 */
export function ModelTab({ draft, set, saved, snap, canEdit }: Props) {
  const { resolvedTheme } = useTheme()
  const [moving, setMoving] = useState<FlowKey | "hub" | null>(null)
  const webgl = useMemo(() => hasWebGL(), [])
  const flows = useMemo(() => (snap ? sceneFlows(snap) : null), [snap])
  const model: SiteModel | null = useMemo(() => (draft ? { ...(saved ?? DEFAULT_SITE_MODEL), ...draft } : null), [draft, saved])
  if (!draft || !model) return <ReadOnly text="Loading the site model…" />

  const placeAt = (key: FlowKey | "hub", p: Vec3) => {
    if (key === "hub") set({ ...draft, hub: p })
    else {
      const anchor = { key, at: p, label: [p[0], p[1] + LABEL_LIFT, p[2]] as Vec3 }
      const others = draft.anchors.filter((a) => a.key !== key)
      set({ ...draft, anchors: [...others, anchor].sort((a, b) => FLOW_KEYS.indexOf(a.key) - FLOW_KEYS.indexOf(b.key)) })
    }
  }
  const place = (p: Vec3) => {
    if (!moving) return
    placeAt(moving, p)
    setMoving(null)
  }
  const rows: { key: FlowKey | "hub"; at: Vec3 | null }[] = [{ key: "hub", at: draft.hub }, ...FLOW_KEYS.map((k) => ({ key: k, at: draft.anchors.find((a) => a.key === k)?.at ?? null }))]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5">
      <div className="relative h-[460px] overflow-hidden rounded-[14px] border border-app-l2 bg-app-gr">
        {flows ? <SiteScene model={model} flows={flows} theme={resolvedTheme} view="iso" onPick={canEdit && moving ? place : undefined} /> : null}
        <div className="absolute left-3 top-3 rounded-md bg-app-pn px-2 py-1 text-xs text-app-sb" data-testid="model-badge">
          {saved && saved.version > 0 ? `Version ${saved.version} · ${saved.source}` : "Default model (App v2 demo scene)"}
        </div>
        {moving ? (
          <div role="status" className="absolute inset-x-3 bottom-3 rounded-lg bg-app-pn px-3 py-2 text-[13px] text-app-tx">
            Click the model where the {NAME[moving].toLowerCase()} is.{" "}
            <button type="button" onClick={() => setMoving(null)} className="p-0 text-tag-grid">
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <section aria-label="Model source" className="flex flex-col gap-2 rounded-[14px] border border-app-l2 bg-app-ps p-4">
          <h2 className="m-0 text-sm font-semibold">Model source</h2>
          <div className="rounded-lg border border-[rgba(62,207,142,.5)] bg-app-ch px-3 py-2 text-[13px]">
            <div className="font-medium">Generated</div>
            <div className="text-xs text-app-sb">A building with a roof array and one device per anchor.</div>
          </div>
          <div className="rounded-lg border border-app-ln px-3 py-2 text-[13px] text-app-dm" aria-disabled="true">
            <div className="font-medium">Upload a 3D file</div>
            <div className="text-xs">.glb or .gltf (OBJ, FBX, SKP, IFC converted), up to 30 MB. Not available yet.</div>
          </div>
        </section>
        <section aria-label="Device anchors" className="flex flex-col gap-2 rounded-[14px] border border-app-l2 bg-app-ps p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-sm font-semibold">Device anchors</h2>
            <span className="text-xs text-app-dm">Move, then click the model</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span>{NAME[r.key]}</span>
                <span className="flex items-center gap-2.5">
                  <span className={cn("font-mono text-xs", r.at ? "text-app-sb" : "text-app-dm")}>{r.at ? fmt(r.at) : "not placed"}</span>
                  {canEdit ? <CoordEditor name={NAME[r.key]} at={r.at ?? [0, 0, 0]} apply={(p) => placeAt(r.key, p)} /> : null}
                  {canEdit && webgl ? (
                    <button type="button" aria-label={`Move ${NAME[r.key]}`} onClick={() => setMoving(r.key)} className={cn("p-0 text-xs", moving === r.key ? "text-tag-pv" : "text-tag-grid")}>
                      {r.at ? "Move" : "Place"}
                    </button>
                  ) : null}
                  {canEdit && r.key !== "hub" && r.at ? (
                    <button type="button" aria-label={`Remove ${NAME[r.key]}`} onClick={() => set({ ...draft, anchors: draft.anchors.filter((a) => a.key !== r.key) })} className="p-0 text-xs text-app-sb">
                      Remove
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button type="button" onClick={() => set({ hub: DEFAULT_SITE_MODEL.hub, anchors: DEFAULT_SITE_MODEL.anchors, buildingLabel: DEFAULT_SITE_MODEL.buildingLabel, camera: DEFAULT_SITE_MODEL.camera })} className="self-start p-0 text-xs text-app-sb">
              Reset to the default model
            </button>
          ) : null}
          {canEdit && !webgl ? <p className="m-0 text-xs text-app-dm">Clicking the model needs a browser with WebGL; type the coordinates instead.</p> : null}
        </section>
        {!canEdit ? <ReadOnly text="Only the owner or installer can edit the site model." /> : null}
      </div>
    </div>
  )
}

const AXES = [
  { name: "x", min: -500, max: 500 },
  { name: "y (height)", min: -50, max: 200 },
  { name: "z", min: -500, max: 500 },
] as const

/** Typed coordinates in metres: the keyboard (and no-WebGL) way to place an anchor. */
function CoordEditor({ name, at, apply }: { name: string; at: Vec3; apply: (p: Vec3) => void }) {
  const [open, setOpen] = useState(false)
  const [xyz, setXyz] = useState<string[]>([])
  if (!open)
    return (
      <button type="button" aria-label={`Type coordinates for ${name}`} onClick={() => { setXyz(at.map((v) => v.toFixed(1))); setOpen(true) }} className="p-0 text-xs text-tag-grid">
        Edit
      </button>
    )
  const nums = xyz.map(Number)
  const valid = xyz.every((v) => v.trim() !== "") && nums.every((v, i) => Number.isFinite(v) && v >= AXES[i].min && v <= AXES[i].max)
  return (
    <form
      aria-label={`Coordinates for ${name}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        apply(nums as unknown as Vec3)
        setOpen(false)
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      className="flex items-center gap-1"
    >
      {AXES.map((a, i) => (
        <input
          key={a.name}
          type="number"
          step="0.1"
          min={a.min}
          max={a.max}
          aria-label={`${name} ${a.name}, metres`}
          value={xyz[i]}
          autoFocus={i === 0}
          onChange={(e) => setXyz(xyz.map((v, j) => (j === i ? e.target.value : v)))}
          className="h-7 w-14 rounded border border-app-ln bg-app-bg px-1 font-mono text-xs text-app-tx"
        />
      ))}
      <button type="submit" disabled={!valid} className="p-0 text-xs text-tag-grid disabled:text-app-dm">
        Apply
      </button>
      <button type="button" onClick={() => setOpen(false)} className="p-0 text-xs text-app-sb">
        Cancel
      </button>
    </form>
  )
}
