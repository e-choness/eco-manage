import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { DEFAULT_SITE_MODEL, sceneFlows, type SiteSnapshot, type SiteToday } from "@ecomanage/shared"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useMe } from "@/hooks/useMe"
import { useNow } from "@/hooks/useNow"
import { useTheme } from "@/components/ui/theme-provider"
import { SiteScene } from "@/components/scene/SiteScene"
import { getSiteModel, getToday } from "@/api/home"
import { NeedsYou } from "./home/NeedsYou"
import { PriceStrip } from "./home/PriceStrip"
import { clockAt, dayLine, duration, money } from "@/lib/format"

const panel = "rounded-[14px] border border-app-ln bg-app-pn px-[18px] py-4 backdrop-blur-[14px]"

/**
 * App v2 Home: the site in 3D with live flows; left, demand, the bill so far and the battery;
 * right, what needs someone; bottom, today's electricity price.
 */
export function Home() {
  const { data: snap, error, connected, lastEventAt } = useSiteLive()
  const model = useQuery({ queryKey: ["site", "model"], queryFn: getSiteModel, staleTime: Infinity })
  const today = useQuery({ queryKey: ["site", "today"], queryFn: getToday, refetchInterval: 5 * 60_000 })
  const { role, membership } = useMe()
  const { resolvedTheme } = useTheme()
  const now = useNow(30_000)
  const flows = useMemo(() => (snap ? sceneFlows(snap) : null), [snap])
  const tz = snap?.site.tz ?? "UTC"
  const money_ = role === "owner" || role === "manager"

  return (
    <main className="relative h-screen min-h-[640px] overflow-hidden bg-app-gr">
      {flows ? <SiteScene model={model.data ?? DEFAULT_SITE_MODEL} flows={flows} theme={resolvedTheme} view="fit" safeLeft={340} safeRight={392} shiftY={-0.03} /> : null}

      <div className="absolute left-8 top-7 flex w-[300px] flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-lg font-semibold" data-testid="site-name">
            {snap?.site.name ?? membership?.siteName}
          </h1>
          <span className="text-[13px] text-app-sb">
            {snap ? `${dayLine(new Date(now), tz)} · ${clockAt(now, tz)} · ` : ""}
            <span data-testid="live-status" data-last-event={lastEventAt ?? ""}>
              {connected ? "live" : snap ? "reconnecting…" : "connecting…"}
            </span>
          </span>
        </div>
        {error && !snap ? (
          <div className={`${panel} text-[13px] text-app-sb`} role="alert">
            Live data isn't available right now: {error.message}
          </div>
        ) : snap ? (
          <div className={`${panel} flex flex-col gap-4`}>
            <Demand snap={snap} tz={tz} />
            {money_ ? <Bill today={today.data} /> : null}
            <Battery snap={snap} />
          </div>
        ) : (
          <div className={`${panel} h-[260px]`} aria-busy="true" />
        )}
      </div>

      <NeedsYou tz={tz} role={role} />

      <div className="absolute bottom-6 left-8 right-[408px]">
        <PriceStrip today={today.data} tz={tz} now={now} />
      </div>
    </main>
  )
}

function Demand({ snap, tz }: { snap: SiteSnapshot; tz: string }) {
  const d = snap.demand
  const cap = snap.site.demandCapKw
  const peak = snap.monthPeak?.kw ?? null
  const scale = cap ?? Math.max(peak ?? 0, d?.soFarKw ?? 0, d?.projectedKw ?? 0) * 1.25
  const pct = (kw: number) => (scale > 0 ? Math.min(100, (kw / scale) * 100) : 0)
  const colour = !d || !cap ? "#5b9dff" : d.projectedKw >= cap ? "#ff7a59" : d.projectedKw >= cap * 0.9 ? "#f2b33d" : "#5b9dff"
  const start = d ? Date.parse(d.intervalStart) : 0
  return (
    <section aria-label="Demand" className="flex flex-col gap-2">
      <div className="flex justify-between text-[13px] text-app-sb">
        <span>Demand</span>
        <span>{cap ? `cap ${cap} kW` : "no cap set"}</span>
      </div>
      <div className="text-[30px] font-semibold leading-none tabular-nums" data-testid="demand-now">
        {d ? d.soFarKw.toFixed(0) : "—"} <span className="text-[13px] font-medium text-app-sb">kW</span>
      </div>
      <div className="relative h-1.5 rounded-[3px] bg-app-tr">
        {d ? <span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${pct(d.soFarKw)}%`, background: colour }} /> : null}
        {peak != null && scale > 0 ? <span className="absolute -top-1 h-3.5 w-[2px] bg-app-tx" style={{ left: `${pct(peak)}%` }} title={`Month peak ${peak} kW`} /> : null}
      </div>
      <div className="text-xs text-app-sb">
        {d
          ? `Projected ${d.projectedKw.toFixed(0)} kW for ${clockAt(start, tz)}–${clockAt(start + 15 * 60_000, tz)}${d.quality === "estimated" ? " (estimated)" : ""}`
          : "No meter reading this quarter hour"}
        {peak != null ? ` · month peak ${peak.toFixed(0)} (marker)` : ""}
      </div>
    </section>
  )
}

function Bill({ today }: { today: SiteToday | undefined }) {
  const b = today?.bill
  return (
    <section aria-label="Bill so far" className="flex flex-col gap-1.5 border-t border-app-ln pt-3.5">
      {b && today ? (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-app-sb">Bill so far · estimate</span>
            <span className="text-[22px] font-semibold tabular-nums" data-testid="bill-so-far">
              {money(b.totalCents, today.currency)}
            </span>
          </div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-app-dm">{b.projectedCents != null ? `heading for ${money(b.projectedCents, today.currency)}` : ""}</span>
            {b.savedCents != null ? <span className="text-tag-bat">{money(b.savedCents, today.currency)} saved</span> : null}
          </div>
        </>
      ) : (
        <span className="text-[13px] text-app-sb">{today ? "No bill for this period yet." : "Loading the bill…"}</span>
      )}
    </section>
  )
}

function Battery({ snap }: { snap: SiteSnapshot }) {
  if (!snap.devices.some((d) => d.type === "battery")) return null
  const b = snap.battery
  const soc = b.socPct == null ? null : Math.round(b.socPct)
  const lit = soc == null ? 0 : Math.round(soc / 20)
  const text =
    b.pKw > 0.05
      ? b.minutesLeft != null
        ? `About ${duration(b.minutesLeft)} to reserve at ${b.pKw.toFixed(0)} kW`
        : `Discharging at ${b.pKw.toFixed(0)} kW`
      : b.pKw < -0.05
        ? `Charging at ${Math.abs(b.pKw).toFixed(0)} kW`
        : `Idle${b.reservePct != null ? ` · reserve ${b.reservePct}%` : ""}`
  return (
    <section aria-label="Battery" className="flex flex-col gap-2 border-t border-app-ln pt-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-app-sb">Battery</span>
        <span className="text-[22px] font-semibold tabular-nums" data-testid="battery-soc">
          {soc == null ? "—" : `${soc}%`}
        </span>
      </div>
      <div className="flex gap-[3px]" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < lit ? "bg-[#3ecf8e]" : "bg-app-tr"}`} />
        ))}
      </div>
      <div className="text-xs text-app-sb">{text}</div>
    </section>
  )
}
