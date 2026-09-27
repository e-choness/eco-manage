import type { HistoryBucket, HistoryRes } from "@ecomanage/shared"

// Local calendar dates ("YYYY-MM-DD") for the History range. Adding days to a calendar date is
// done in UTC, where no day is 23 or 25 hours long.

export const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export type Preset = "today" | "7d" | "month" | "lastmonth" | "year" | "all" | "custom"

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All data" },
  { id: "custom", label: "Custom" },
]

/** The dates a preset covers, given today and the first day with data (site time). */
export const presetRange = (p: Exclude<Preset, "custom">, today: string, dataStart: string): { from: string; to: string } => {
  const month = today.slice(0, 7)
  if (p === "today") return { from: today, to: today }
  if (p === "7d") return { from: shiftDate(today, -6), to: today }
  if (p === "month") return { from: `${month}-01`, to: today }
  if (p === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today }
  if (p === "all") return { from: dataStart, to: today }
  const lastDay = shiftDate(`${month}-01`, -1)
  return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay }
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${date}T00:00:00Z`)).replace("Sept", "Sep")

/** "1–24 Sep 2026", "28 Aug – 3 Sep 2026", "24 Sep 2025 – 24 Sep 2026" */
export const rangeText = (from: string, to: string): string => {
  if (from === to) return fmt(from, { day: "numeric", month: "short", year: "numeric" })
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`
  return `${fmt(from, { day: "numeric", month: "short", year: "numeric" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`
}

/** A bar's axis label and full tooltip time, in the site's zone. */
export const bucketLabel = (b: Pick<HistoryBucket, "start">, res: HistoryRes, tz: string): { short: string; full: string } => {
  const at = new Date(b.start)
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(at).replace("Sept", "Sep").replace(",", "")
  if (res === "15m" || res === "h") return { short: f({ hour: "2-digit", minute: "2-digit", hour12: false }).replace(/:00$/, ""), full: f({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) }
  if (res === "d") return { short: f({ day: "numeric" }), full: f({ weekday: "short", day: "numeric", month: "short", year: "numeric" }) }
  if (res === "w") return { short: f({ day: "numeric", month: "short" }), full: `Week of ${f({ day: "numeric", month: "short", year: "numeric" })}` }
  return { short: f({ month: "short", year: "2-digit" }), full: f({ month: "long", year: "numeric" }) }
}
