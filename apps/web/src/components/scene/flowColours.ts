import type { FlowKey } from "@ecomanage/shared"

/** Device colours (App v2 COL), the same in both themes. */
export const FLOW_COLOURS: Record<FlowKey | "building", string> = {
  pv: "#f2b33d",
  battery: "#3ecf8e",
  grid: "#5b9dff",
  ev: "#b48cff",
  heatpump: "#ff7a59",
  building: "#9aa7bd",
}
