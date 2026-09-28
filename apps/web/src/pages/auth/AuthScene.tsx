import { useEffect, useState } from "react"
import { DEFAULT_SITE_MODEL, type SceneFlows } from "@ecomanage/shared"
import { SiteScene } from "@/components/scene/SiteScene"
import { useTheme } from "@/components/ui/theme-provider"

// The picture beside the sign-in and invite forms: Home's site scene with the demo building and
// sample flows, since nothing about a real site may be shown before signing in. The numbers drift
// a little every few seconds, like a sunny school afternoon, and always balance at the switchboard.

const STEP_MS = 4000

/** Sample flows at step `n`: solar with passing cloud, EV charging sessions, the grid the rest. */
const sampleFlows = (n: number): SceneFlows => {
  const pv = 34.8 + 3.2 * Math.sin(n / 3)
  const ev = 22 + 7.4 * Math.max(0, Math.sin(n / 5 + 1))
  const hp = 18.3
  const battery = 12
  const building = 48.1 + 1.5 * Math.sin(n / 2)
  const grid = building + ev + hp - pv - battery
  const one = (x: number) => Math.round(x * 10) / 10
  return {
    pv: { label: "Solar", kw: one(pv), dir: "in", sub: "86 kW rated" },
    battery: { label: "Battery", kw: battery, dir: "in", sub: "64% · discharging", soc: 64 },
    grid: { label: "Grid", kw: one(grid), dir: "in", sub: "importing" },
    ev: { label: "EV chargers", kw: one(ev), dir: "out", sub: ev > 25 ? "3 charging" : "2 charging" },
    heatpump: { label: "Heat pump", kw: hp, dir: "out", sub: "running" },
    building: { label: "Building", kw: one(building), dir: null, sub: "calculated remainder" },
  }
}

export function AuthScene() {
  const { resolvedTheme } = useTheme()
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), STEP_MS)
    return () => clearInterval(t)
  }, [])
  return (
    <div aria-hidden className="relative hidden overflow-hidden bg-app-gr lg:block">
      <SiteScene model={DEFAULT_SITE_MODEL} flows={sampleFlows(n)} theme={resolvedTheme} view="fit" />
    </div>
  )
}
