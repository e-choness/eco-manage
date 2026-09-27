// The four History views (App v2): what each stacks, in which colours, and how it reads.

export type View = "sources" | "consumers" | "demand" | "cost"

export type Key = "used" | "batt" | "grid" | "bld" | "hp" | "ev" | "peakKw" | "costCents"

export const kwh = (x: number) => `${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(1)} kWh`

export const VIEWS: Record<View, { label: string; keys: [Key, string, string][]; fmt: (x: number, currency: string) => string }> = {
  sources: {
    label: "Energy sources",
    keys: [
      ["used", "Solar used on site", "#f2b33d"],
      ["batt", "Battery", "#3ecf8e"],
      ["grid", "Grid import", "#5b9dff"],
    ],
    fmt: kwh,
  },
  consumers: {
    label: "Consumers",
    keys: [
      ["bld", "Building (calculated)", "#9aa7bd"],
      ["hp", "Heat pump", "#ff7a59"],
      ["ev", "EV charging", "#b48cff"],
    ],
    fmt: kwh,
  },
  demand: { label: "Demand", keys: [["peakKw", "Highest 15-min demand", "#5b9dff"]], fmt: (x) => `${Math.round(x)} kW` },
  cost: {
    label: "Energy cost",
    keys: [["costCents", "Energy cost (TOU)", "#b48cff"]],
    fmt: (x, currency) => new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(x / 100),
  },
}
