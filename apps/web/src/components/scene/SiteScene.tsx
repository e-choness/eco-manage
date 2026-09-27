import { useEffect, useRef, useState } from "react"
import { FLOW_KEYS, type SceneFlows, type SceneView, type SiteModel, type Vec3 } from "@ecomanage/shared"
import { SiteFlow2D } from "./SiteFlow2D"
import { createScene, hasWebGL, type SceneHandle } from "./sceneEngine"

interface Props {
  model: SiteModel
  flows: SceneFlows
  theme: "dark" | "light"
  view?: SceneView
  safeLeft?: number
  safeRight?: number
  shiftY?: number
  /** Click to pick a point on the site (Settings → Site model). */
  onPick?: (p: Vec3) => void
  className?: string
}

/**
 * The site in 3D (App v2 Home), with live flows. Without WebGL, or if three.js fails to load, the
 * same flows are drawn flat. A table with the same numbers is always there for screen readers.
 */
export function SiteScene({ model, flows, theme, view, safeLeft, safeRight, shiftY, className, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<SceneHandle | null>(null)
  const latest = useRef(flows)
  const pick = useRef(onPick)
  const picking = !!onPick
  const [flat, setFlat] = useState(() => !hasWebGL())
  // The newest flows and pick handler, for the scene built below (refs are written after render).
  useEffect(() => {
    pick.current = onPick
    latest.current = flows
  })

  // (Re)build when the look or the model changes; flows update in place below.
  useEffect(() => {
    if (flat || !host.current) return
    let cancelled = false
    createScene(host.current, { theme, model, view, safeLeft, safeRight, shiftY, onPick: picking ? (p) => pick.current?.(p) : undefined }, latest.current)
      .then((h) => {
        if (cancelled) h.dispose()
        else handle.current = h
      })
      .catch(() => {
        if (!cancelled) setFlat(true)
      })
    return () => {
      cancelled = true
      handle.current?.dispose()
      handle.current = null
    }
  }, [flat, theme, model, view, safeLeft, safeRight, shiftY, picking])

  useEffect(() => {
    handle.current?.setFlows(flows)
  }, [flows])

  const rows = [...FLOW_KEYS, "building" as const].filter((k) => flows[k])
  return (
    <div ref={host} className={className ?? "absolute inset-0 overflow-hidden"}>
      {flat ? <SiteFlow2D flows={flows} safeLeft={safeLeft} safeRight={safeRight} /> : null}
      <table className="sr-only">
        <caption>Power flows now</caption>
        <thead>
          <tr>
            <th scope="col">Source or load</th>
            <th scope="col">kW</th>
            <th scope="col">Direction</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => {
            const f = flows[k]!
            return (
              <tr key={k}>
                <th scope="row">{f.label}</th>
                <td>{f.kw.toFixed(1)}</td>
                <td>{f.dir === "in" ? "into the site" : f.dir === "out" ? "out of the switchboard" : "none"}</td>
                <td>{f.sub}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
