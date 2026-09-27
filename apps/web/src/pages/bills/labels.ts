import { siteDate, type BillSummary } from "@ecomanage/shared"
import { money } from "@/lib/format"

// Words for bills (App v2 Bills), shared by the chart, the list and the period panel.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "2026-09" → "Sep 2026" */
export const monthLabel = (period: string): string => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`

/** The last local day of a period whose `end` is the (exclusive) start of the next one. */
export const lastLocalDay = (end: string, tz: string): string => siteDate(new Date(Date.parse(end) - 1), tz)

/** The list's utility column: where the utility bill stands, and how close our estimate is. */
export const utilityStatus = (b: BillSummary, currency: string): { text: string; className: string } => {
  if (b.inProgress) return { text: `In progress · ${b.days.elapsed} of ${b.days.total} days`, className: "text-app-sb" }
  const u = b.utility
  if (u?.status === "processing") return { text: "Reading uploaded bill…", className: "text-tag-pv" }
  if (u?.status === "failed") return { text: "Couldn't read the uploaded bill", className: "text-tag-hp" }
  if (!u || u.totalCents == null) return { text: "Not uploaded", className: "text-app-dm" }
  const pct = ((b.totalCents - u.totalCents) / u.totalCents) * 100
  return {
    text: `Utility ${money(u.totalCents, currency)} · ours ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`,
    className: Math.abs(pct) < 2 ? "text-tag-bat" : "text-tag-pv",
  }
}
