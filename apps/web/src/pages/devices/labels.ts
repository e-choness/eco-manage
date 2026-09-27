import { displayKw, type DeviceDetail, type DeviceView, type ProfileActionView } from "@ecomanage/shared"
import { clockAt } from "@/lib/format"

// Words and colours for devices (App v2 Devices), shared by the list and the detail panel.

export const DEVICE_COLOUR: Record<DeviceView["type"], string> = {
  pv: "#f2b33d",
  battery: "#3ecf8e",
  meter: "#5b9dff",
  submeter: "#9aa7bd",
  ev: "#b48cff",
  heatpump: "#ff7a59",
  gateway: "#9aa7bd",
}

export const STATUS: Record<DeviceView["status"], { text: string; className: string }> = {
  live: { text: "Online", className: "text-tag-bat" },
  stale: { text: "Stale", className: "text-tag-pv" },
  offline: { text: "No data", className: "text-tag-hp" },
  pending: { text: "Not commissioned", className: "text-app-dm" },
}

/** "Solar inverter · 50 kW", "Battery · 200 kWh" */
export const kindOf = (d: Pick<DeviceView, "type" | "ratedKw" | "capacityKwh">): string => {
  const rated = d.ratedKw ? ` · ${d.ratedKw} kW` : ""
  switch (d.type) {
    case "pv":
      return `Solar inverter${rated}`
    case "battery":
      return `Battery${d.capacityKwh ? ` · ${d.capacityKwh} kWh` : rated}`
    case "meter":
      return "Grid meter"
    case "submeter":
      return "Sub-meter"
    case "ev":
      return `EV charger${rated}`
    case "heatpump":
      return `Heat pump${rated}`
    default:
      return "Edge gateway"
  }
}

/** Power as people read it: loads positive (the site convention stores them negative). */
export const kwNow = (d: Pick<DeviceView, "type" | "latest">): number | null => (d.latest ? displayKw(d.type, d.latest.p_kw) : null)

/** The "Data" row: how fresh and how good the latest reading is. */
export const qualityOf = (d: DeviceDetail, tz: string): { text: string; className: string } => {
  if (!d.latest) return { text: "No data yet", className: "text-app-dm" }
  if (d.status === "stale" || d.status === "offline" || d.latest.q === "stale")
    return { text: `Stale · last reading ${clockAt(d.latest.ts, tz)}`, className: "text-tag-hp" }
  if (d.latest.q === "estimated") return { text: "Live · latest reading estimated", className: "text-tag-pv" }
  if (d.latest.q === "backfilled") return { text: "Live · caught up from the gateway buffer", className: "text-tag-pv" }
  const every = d.profile ? `every ${Math.round(d.profile.pollMs / 100) / 10} s` : "live"
  return { text: `Live · ${every}`, className: "text-tag-bat" }
}

/** Actions a person can ask for on the Devices page: not restarts (alert fixes), not schedules. */
export const proposable = (d: DeviceDetail): ProfileActionView[] =>
  (d.profile?.actions ?? []).filter((a) => a.id !== "restart" && !Object.values(a.params).some((p) => p.type === "schedule"))
