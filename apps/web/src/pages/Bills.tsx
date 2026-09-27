import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { siteDate } from "@ecomanage/shared"
import { getBills, getRangeSpend } from "@/api/bills"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useMe } from "@/hooks/useMe"
import { PageFrame } from "@/shell/AppShell"
import { clockAt, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { rangeText } from "./history/dates"
import { BillPanel } from "./bills/BillPanel"
import { monthLabel, utilityStatus } from "./bills/labels"

const card = "rounded-[14px] border border-app-l2 bg-app-ps"
const field = "h-[34px] rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx outline-hidden focus-visible:ring-2 focus-visible:ring-ring"

/**
 * App v2 Bills (owners and managers): the last 12 months at a glance, every bill as a chart and a
 * list, the selected period in detail, and spending for any date range.
 */
export function Bills() {
  const bills = useQuery({ queryKey: ["bills"], queryFn: getBills })
  const { data: snap } = useSiteLive()
  const { role } = useMe()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tz = snap?.site.tz ?? "UTC"
  const currency = snap?.site.currency ?? "CAD"
  const m = (c: number) => money(c, currency)
  const items = bills.data?.items ?? []
  const selected = items.find((b) => b.period === params.get("period")) ?? items[0]
  const select = (period: string) => setParams({ period }, { replace: true })
  const k = bills.data?.kpis

  const today = siteDate(new Date(), tz)
  const firstDay = items.length ? siteDate(new Date(items[items.length - 1].start), tz) : today
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const r = range ?? (selected ? { from: siteDate(new Date(selected.start), tz), to: today } : null)
  const spend = useQuery({
    queryKey: ["bills", "range", r?.from, r?.to],
    queryFn: () => getRangeSpend(r!.from <= r!.to ? r!.from : r!.to, r!.from <= r!.to ? r!.to : r!.from),
    enabled: !!r,
    placeholderData: keepPreviousData,
  })

  const chron = [...items].reverse()
  const maxTotal = Math.max(1, ...items.map((b) => b.totalCents))
  const kpis = k
    ? [
        { label: "Last 12 months", value: k.last12 ? m(k.last12.totalCents) : "—", note: k.last12 ? `${monthLabel(k.last12.from)} – ${monthLabel(k.last12.to)}` : "No closed bills yet" },
        { label: "Saved, last 12 months", value: k.saved12Cents != null ? m(k.saved12Cents) : "—", note: "vs buying all energy from the grid" },
        { label: "Highest demand, last 12 months", value: k.peak12 ? `${Math.round(k.peak12.kw)} kW` : "—", note: k.peak12 ? `${monthLabel(k.peak12.period)} · ${m(k.peak12.demandCents)} demand charge` : "" },
        { label: "Our estimate vs utility bills", value: k.utilityDiffPct != null ? `±${k.utilityDiffPct.toFixed(1)}%` : "—", note: k.compared ? `${k.compared} bill${k.compared > 1 ? "s" : ""} compared` : "Upload utility bills to compare" },
      ]
    : []

  return (
    <PageFrame title="Bills">
      {bills.isError ? <p className="m-0 text-[13px] text-app-sb">Bills couldn't be loaded: {bills.error.message}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5" role="list" aria-label="Bill figures">
        {kpis.map((x) => (
          <div key={x.label} role="listitem" className={cn(card, "flex flex-col gap-1 px-4 py-3.5")}>
            <span className="text-[13px] text-app-sb">{x.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{x.value}</span>
            <span className="text-xs text-app-dm">{x.note}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="all-bills" className={cn(card, "flex flex-col gap-3 px-5 py-[18px]")}>
        <div className="flex flex-wrap justify-between gap-3">
          <h2 id="all-bills" className="m-0 text-sm font-semibold">
            Every bill since the system started
          </h2>
          <span className="flex gap-3.5 text-xs text-app-sb">
            {[
              ["Energy", "#5b9dff"],
              ["Demand", "#b48cff"],
              ["Fixed", "#9aa7bd"],
            ].map(([label, colour]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-sm" style={{ background: colour }} aria-hidden />
                {label}
              </span>
            ))}
            <span>Click a month to open it</span>
          </span>
        </div>
        <div className="flex h-[150px] items-end gap-1">
          {chron.map((b, i) => {
            const energy = b.lines.energyPkCents + b.lines.energyMdCents + b.lines.energyOpCents
            const month = Number(b.period.slice(5, 7))
            return (
              <button
                key={b.period}
                type="button"
                onClick={() => select(b.period)}
                aria-pressed={b.period === selected?.period}
                aria-label={`${monthLabel(b.period)}: ${m(b.totalCents)}${b.inProgress ? " so far" : ""}`}
                title={`${monthLabel(b.period)}: ${m(b.totalCents)}${b.inProgress ? " so far" : ""}`}
                className="flex h-full min-w-0 max-w-[48px] flex-1 flex-col justify-end gap-[5px] p-0"
                data-testid="bill-bar"
              >
                <span
                  className={cn(
                    "flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] outline-offset-2",
                    b.period === selected?.period ? "outline-solid outline-2 outline-app-tx" : b.inProgress ? "outline-dashed outline-[1.5px] outline-app-sb" : "opacity-80"
                  )}
                  style={{ height: `${Math.max(2, (b.totalCents / maxTotal) * 128)}px` }}
                >
                  <span className="block min-h-0 bg-flow-grid" style={{ flex: `${Math.max(0, energy)} 1 0` }} />
                  <span className="block min-h-0 bg-flow-ev" style={{ flex: `${Math.max(0, b.lines.demandCents)} 1 0` }} />
                  <span className="block min-h-0 bg-flow-gw" style={{ flex: `${Math.max(0, b.lines.fixedCents)} 1 0` }} />
                </span>
                <span className="h-3 whitespace-nowrap text-center font-mono text-[10px] text-app-dm">
                  {month % 3 === 1 || i === 0 ? `${monthLabel(b.period).slice(0, 3)}${month === 1 || i === 0 ? ` ${b.period.slice(2, 4)}` : ""}` : ""}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-5">
        <div className={cn(card, "max-h-[620px] overflow-auto")} role="table" aria-label="Bills">
          <div role="row" className="sticky top-0 grid grid-cols-[minmax(0,1fr)_90px_64px_minmax(0,1.4fr)] gap-2.5 border-b border-app-l2 bg-app-ps px-[18px] py-3 text-xs text-app-dm">
            <span role="columnheader">Period</span>
            <span role="columnheader" className="text-right">
              Our estimate
            </span>
            <span role="columnheader" className="text-right">
              Peak
            </span>
            <span role="columnheader">Utility bill</span>
          </div>
          {items.map((b) => {
            const st = utilityStatus(b, currency)
            return (
              <button
                key={b.period}
                type="button"
                role="row"
                aria-selected={b.period === selected?.period}
                onClick={() => select(b.period)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_90px_64px_minmax(0,1.4fr)] items-center gap-2.5 border-b border-app-l2 px-[18px] py-3 text-left text-sm text-app-tx last:border-b-0 hover:bg-app-hv",
                  b.period === selected?.period && "bg-app-hv"
                )}
              >
                <span role="cell">{monthLabel(b.period)}</span>
                <span role="cell" className="text-right tabular-nums">
                  {m(b.totalCents)}
                </span>
                <span role="cell" className="text-right text-[13px] text-app-sb">
                  {Math.round(b.peakKw)} kW
                </span>
                <span role="cell" className={cn("text-xs", st.className)}>
                  {st.text}
                </span>
              </button>
            )
          })}
          {bills.isSuccess && !items.length ? <p className="m-0 p-5 text-[13px] text-app-sb">No bills yet. The first one appears once a day of data has been priced.</p> : null}
        </div>
        {selected ? <BillPanel key={selected.period} bill={selected} tz={tz} currency={currency} canUpload={role === "owner"} /> : <div />}
      </div>

      <section aria-labelledby="range-spend" className={cn(card, "flex flex-col gap-3.5 px-5 py-[18px]")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="range-spend" className="m-0 text-sm font-semibold">
              Spending for any date range
            </h2>
            <span className="text-[13px] text-app-sb">Uses the tariff version that applied on each day.</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-app-dm">
              From
              <input type="date" min={firstDay} max={today} value={r?.from ?? ""} onChange={(e) => e.target.value && r && setRange({ ...r, from: e.target.value })} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-app-dm">
              To
              <input type="date" min={firstDay} max={today} value={r?.to ?? ""} onChange={(e) => e.target.value && r && setRange({ ...r, to: e.target.value })} className={field} />
            </label>
            <button type="button" disabled={!spend.data} onClick={() => spend.data && navigate(`/history?from=${spend.data.from}&to=${spend.data.to}`)} className="h-[34px] rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx disabled:opacity-70">
              Open in History
            </button>
          </div>
        </div>
        {spend.data ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3" role="list" aria-label="Range spending">
            {[
              { label: "Energy cost (TOU)", value: m(spend.data.energyCents), note: rangeText(spend.data.from, spend.data.to) },
              { label: "Export credit", value: m(-spend.data.exportCreditCents), note: `${Math.round(spend.data.exportKwh).toLocaleString("en-US")} kWh sold` },
              { label: "Bought from grid", value: `${Math.round(spend.data.gridKwh).toLocaleString("en-US")} kWh`, note: `${spend.data.days} day${spend.data.days > 1 ? "s" : ""}` },
              {
                label: "Highest 15-min demand",
                value: spend.data.peak ? `${Math.round(spend.data.peak.kw)} kW` : "—",
                note: spend.data.peak ? `${rangeText(siteDate(new Date(spend.data.peak.at), tz), siteDate(new Date(spend.data.peak.at), tz))} ${clockAt(spend.data.peak.at, tz)}` : "",
              },
            ].map((x) => (
              <div key={x.label} role="listitem" className="flex flex-col gap-1 rounded-[10px] bg-app-bg px-3.5 py-3">
                <span className="text-xs text-app-dm">{x.label}</span>
                <span className="text-xl font-semibold tabular-nums">{x.value}</span>
                <span className="text-xs text-app-dm">{x.note}</span>
              </div>
            ))}
          </div>
        ) : spend.isError ? (
          <p className="m-0 text-[13px] text-app-sb">{spend.error.message}</p>
        ) : null}
        <p className="m-0 text-xs text-app-dm">Demand charges are billed once per billing period, so they aren't split across custom ranges. The highest demand in the range is shown instead.</p>
      </section>
    </PageFrame>
  )
}
