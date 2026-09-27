import type { SiteToday } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import { clockAt, duration, unitPrice } from "@/lib/format"

const LEVEL = {
  off: "bg-price-off text-tag-grid",
  mid: "bg-price-mid text-app-sb",
  peak: "bg-price-peak text-tag-hp",
} as const

/** Today's energy price by period (App v2 Home, bottom), with where we are now and the next peak. */
export function PriceStrip({ today, tz, now }: { today: SiteToday | undefined; tz: string; now: number }) {
  const segs = today?.prices ?? null
  const panel = "rounded-[14px] border border-app-ln bg-app-pn px-[18px] py-3.5 backdrop-blur-[14px]"
  if (!today) return <section aria-label="Electricity price today" className={cn(panel, "h-[86px]")} aria-busy="true" />
  if (!segs?.length)
    return (
      <section aria-label="Electricity price today" className={cn(panel, "text-[13px] text-app-sb")}>
        Electricity price today: no tariff covers today yet. It is set in Settings → Tariff.
      </section>
    )

  const dayStart = Date.parse(segs[0].start)
  const span = Date.parse(segs[segs.length - 1].end) - dayStart
  const pct = (a: number) => Math.min(100, Math.max(0, ((a - dayStart) / span) * 100))
  const current = segs.find((s) => Date.parse(s.start) <= now && now < Date.parse(s.end))
  const nextPeak = segs.find((s) => s.level === "peak" && Date.parse(s.start) > now)
  const seen = new Set<string>()

  return (
    <section aria-label="Electricity price today" className={cn(panel, "flex flex-col gap-2.5")}>
      <div className="flex justify-between text-[13px]">
        <span className="text-app-sb">Electricity price today</span>
        <span data-testid="next-peak">
          {current?.level === "peak" ? (
            <span className="text-tag-hp">Peak until {clockAt(current.end, tz)}</span>
          ) : nextPeak ? (
            <>
              <span className="text-tag-hp">Peak starts {clockAt(nextPeak.start, tz)}</span>
              <span className="text-app-sb"> · in {duration((Date.parse(nextPeak.start) - now) / 60_000)}</span>
            </>
          ) : (
            <span className="text-app-sb">No peak for the rest of today</span>
          )}
        </span>
      </div>
      <div className="relative flex h-[26px] gap-[2px] overflow-hidden rounded-[7px] font-mono text-[11px]">
        {segs.map((s) => {
          const width = pct(Date.parse(s.end)) - pct(Date.parse(s.start))
          const key = `${s.name}|${s.rateCents}`
          const label = `${s.name.toLowerCase()}${seen.has(key) ? "" : ` ${unitPrice(s.rateCents, today.currency)}`}`
          seen.add(key)
          return (
            <div
              key={s.start}
              data-testid="price-seg"
              title={`${s.name} ${unitPrice(s.rateCents, today.currency)}/kWh, ${clockAt(s.start, tz)}–${clockAt(s.end, tz)}`}
              className={cn("flex items-center overflow-hidden whitespace-nowrap pl-2", LEVEL[s.level])}
              style={{ flex: `${width} 1 0%` }}
            >
              {width >= 7 ? label : ""}
            </div>
          )
        })}
        {now >= dayStart && now < dayStart + span ? (
          <div data-testid="price-now" className="absolute inset-y-0 w-[2px] bg-app-tx" style={{ left: `${pct(now)}%` }} aria-hidden />
        ) : null}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-app-dm" aria-hidden>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </section>
  )
}
