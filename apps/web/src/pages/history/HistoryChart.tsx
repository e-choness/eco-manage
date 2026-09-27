import type { HistoryBucket, HistoryRes } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import { bucketLabel } from "./dates"
import { VIEWS, type Key, type View } from "./views"

const valueOf = (b: HistoryBucket, k: Key) => (b[k] as number | null) ?? 0

/**
 * History chart (App v2): stacked bars per bucket, estimated buckets outlined dashed, empty ones
 * faint. The demand view marks the cap. A table with the same numbers is there for screen readers.
 */
export function HistoryChart({ buckets, res, view, tz, capKw, currency }: { buckets: HistoryBucket[]; res: HistoryRes; view: View; tz: string; capKw: number | null; currency: string }) {
  const v = VIEWS[view]
  const totals = buckets.map((b) => v.keys.reduce((s, [k]) => s + valueOf(b, k), 0))
  const showCap = view === "demand" && capKw != null
  const max = Math.max(1, ...totals, showCap ? capKw * 1.12 : 0)
  const every = Math.ceil(buckets.length / 12)
  const gap = buckets.length <= 40 ? "gap-[5px]" : buckets.length <= 120 ? "gap-[2px]" : "gap-px"
  const labels = buckets.map((b) => bucketLabel(b, res, tz))
  const tip = (b: HistoryBucket, i: number) =>
    b.n === 0 ? `${labels[i].full}: no data` : `${labels[i].full} · ${v.keys.map(([k, l]) => `${l} ${v.fmt(valueOf(b, k), currency)}`).join(" · ")}${b.estimated ? " · estimated" : ""}`

  return (
    <div className="relative">
      {showCap ? (
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-tag-hp" style={{ bottom: `calc(20px + ${(capKw / max) * 220}px)` }}>
          <span className="absolute -top-4 right-0 text-[11px] text-tag-hp">cap {capKw} kW</span>
        </div>
      ) : null}
      <div className={cn("flex h-[240px] items-end", gap)} role="img" aria-label={`${v.label}, ${buckets.length} bars`}>
        {buckets.map((b, i) => (
          <div key={b.start} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={tip(b, i)} data-testid="history-bar">
            <div
              className={cn("flex flex-col-reverse overflow-hidden rounded-t-[3px]", b.estimated && "outline-dashed outline-[1.5px] -outline-offset-1 outline-app-sb", b.n === 0 && "opacity-25")}
              style={{ height: `${(totals[i] / max) * 220}px` }}
              data-estimated={b.estimated || undefined}
            >
              {v.keys.map(([k, , colour]) => (
                <span key={k} style={{ height: totals[i] ? `${(valueOf(b, k) / totals[i]) * 100}%` : 0, background: colour }} />
              ))}
            </div>
            <span className="mt-1 h-4 whitespace-nowrap text-[10px] text-app-dm">{i % every === 0 ? labels[i].short : ""}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{v.label}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {v.keys.map(([k, l]) => (
              <th key={k} scope="col">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b.start}>
              <th scope="row">{labels[i].full}</th>
              {v.keys.map(([k]) => (
                <td key={k}>{b.n ? v.fmt(valueOf(b, k), currency) : "no data"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
