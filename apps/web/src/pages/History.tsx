import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { RES_LABEL, changePct, siteDate, type HistoryRes, type HistoryTotals } from "@ecomanage/shared"
import { createExport, download, getExport, getSeries, getTotals } from "@/api/history"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useMe } from "@/hooks/useMe"
import { useToast } from "@/hooks/useToast"
import { PageFrame } from "@/shell/AppShell"
import { cn } from "@/lib/utils"
import { PRESETS, presetRange, rangeText, type Preset } from "./history/dates"
import { HistoryChart } from "./history/HistoryChart"
import { VIEWS, kwh, type View } from "./history/views"
import { Reports } from "./history/Reports"

const field = "h-9 rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring"
const chip = (on: boolean) => cn("h-8 rounded-lg px-3 text-[13px]", on ? "bg-app-ch text-app-tx" : "text-app-sb hover:text-app-tx")
const EXPORT_POLL_MS = 1000

/**
 * App v2 History: any range of the site's data at a resolution that fits the chart, totals with a
 * comparison, four views, CSV export and reports.
 */
export function History() {
  const { data: snap } = useSiteLive()
  const { role, me } = useMe()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const tz = snap?.site.tz ?? "UTC"
  const today = siteDate(new Date(), tz)
  const money = role === "owner" || role === "manager"

  const [preset, setPreset] = useState<Preset>(params.get("from") ? "custom" : "month")
  const [range, setRange] = useState(() => ({ from: params.get("from") ?? `${today.slice(0, 7)}-01`, to: params.get("to") ?? today }))
  const [res, setRes] = useState<HistoryRes | "auto">("auto")
  const [compare, setCompare] = useState<"none" | "prev" | "yoy">("none")
  const [view, setView] = useState<View>("sources")
  const [builderOpen, setBuilderOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const series = useQuery({ queryKey: ["history", "series", range.from, range.to, res], queryFn: () => getSeries(range.from, range.to, res), placeholderData: keepPreviousData })
  const totals = useQuery({ queryKey: ["history", "totals", range.from, range.to, compare], queryFn: () => getTotals(range.from, range.to, compare), placeholderData: keepPreviousData })
  const s = series.data
  const dataStart = s?.dataStart ?? "2000-01-01"
  const shownView: View = !money && view === "cost" ? "sources" : view

  const pick = (p: Preset) => {
    setPreset(p)
    if (p !== "custom") setRange(presetRange(p, today, dataStart))
  }
  const setDate = (key: "from" | "to", value: string) => {
    if (!value) return
    setPreset("custom")
    setRange({ ...range, [key]: value })
  }

  // An export link from the email: /history?export=<id>
  const exportParam = params.get("export")
  const linked = useQuery({ queryKey: ["export", exportParam], queryFn: () => getExport(exportParam!), enabled: !!exportParam, retry: false })

  const runExport = async () => {
    setExporting(true)
    try {
      let e = await createExport(s?.from ?? range.from, s?.to ?? range.to)
      if (e.large) toast({ description: "That's a big export. It's being made now, and a link is also emailed to you when it's ready." })
      for (let i = 0; i < 120 && e.status === "queued"; i++) {
        await new Promise((r) => setTimeout(r, EXPORT_POLL_MS))
        e = await getExport(e.id)
      }
      if (e.status === "done") await download(`/api/exports/${e.id}/file`, `energy-${e.from}-to-${e.to}.csv`)
      else if (e.status === "failed") toast({ variant: "destructive", description: `The export failed: ${e.error ?? "unknown error"}` })
      else toast({ description: "The export is still being made. It will be emailed to you when ready." })
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error ? err.message : "The export couldn't start." })
    } finally {
      setExporting(false)
    }
  }

  // Keep the dates shown in step with what the server drew (it may have moved them into the data).
  useEffect(() => {
    if (s && preset === "all" && (s.from !== range.from || s.to !== range.to)) setRange({ from: s.from, to: s.to })
  }, [s, preset, range.from, range.to])

  const warnings = (s?.warnings ?? []).filter((w) => !(preset === "all" && w.startsWith("No data before")))
  const t = totals.data
  const cmp = t?.compare
  const delta = (get: (x: HistoryTotals) => number | null, note: string) => {
    if (compare === "none" || !t) return note
    if (!cmp?.totals) return "No data to compare"
    const p = changePct(get(t.totals), get(cmp.totals))
    return p == null ? "No data to compare" : `${p >= 0 ? "+" : "−"}${Math.abs(p)}% vs ${rangeText(cmp.from, cmp.to)}`
  }
  const currency = snap?.site.currency ?? "CAD"
  const cards: { label: string; value: string; colour: string; delta: string }[] = t
    ? [
        { label: "Solar produced", value: kwh(t.totals.pvKwh), colour: "#f2b33d", delta: delta((x) => x.pvKwh, "") },
        { label: "Bought from grid", value: kwh(t.totals.gridKwh), colour: "#5b9dff", delta: delta((x) => x.gridKwh, "") },
        { label: "Sold to grid", value: kwh(t.totals.exportKwh), colour: "#9aa7bd", delta: delta((x) => x.exportKwh, "") },
        {
          label: "Highest demand",
          value: t.totals.peak ? `${Math.round(t.totals.peak.kw)} kW` : "—",
          colour: "#ff7a59",
          delta: delta((x) => x.peak?.kw ?? null, t.totals.peak ? `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(t.totals.peak.at)).replace("Sept", "Sep")}` : ""),
        },
        ...(money && t.totals.costCents != null
          ? [{ label: "Energy cost", value: VIEWS.cost.fmt(t.totals.costCents, currency), colour: "#b48cff", delta: delta((x) => x.costCents, "TOU energy only") }]
          : []),
      ]
    : []

  return (
    <PageFrame title="History">
      <div className="flex flex-wrap items-end gap-3.5 rounded-[14px] border border-app-l2 bg-app-ps p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-app-sb">Period</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => pick(p.id)} className={chip(preset === p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
          From
          <input type="date" min={dataStart} max={today} value={s?.from ?? range.from} onChange={(e) => setDate("from", e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
          To
          <input type="date" min={dataStart} max={today} value={s?.to ?? range.to} onChange={(e) => setDate("to", e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
          Resolution
          <select value={res} onChange={(e) => setRes(e.target.value as HistoryRes | "auto")} className={field}>
            <option value="auto">Auto</option>
            <option value="15m">15-min</option>
            <option value="h">Hourly</option>
            <option value="d">Daily</option>
            <option value="w">Weekly</option>
            <option value="mo">Monthly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
          Compare with
          <select value={compare} onChange={(e) => setCompare(e.target.value as typeof compare)} className={field}>
            <option value="none">Nothing</option>
            <option value="prev">Previous period</option>
            <option value="yoy">Same period last year</option>
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => void runExport()} disabled={exporting || !s} className="h-9 rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx disabled:opacity-70">
            {exporting ? "Preparing CSV…" : "Export CSV"}
          </button>
          <button type="button" onClick={() => setBuilderOpen(true)} className="h-9 rounded-lg bg-[#3ecf8e] px-3.5 text-[13px] font-semibold text-[#06140d]">
            Create report
          </button>
        </div>
      </div>

      {exportParam ? (
        <div role="status" className="flex items-center justify-between rounded-xl border border-app-ln bg-app-ps px-4 py-3 text-[13px]">
          <span className="text-app-sb">
            {linked.data
              ? linked.data.status === "done"
                ? `Your export for ${rangeText(linked.data.from, linked.data.to)} is ready.`
                : linked.data.status === "failed"
                  ? `That export failed: ${linked.data.error ?? "unknown error"}`
                  : "That export is still being made."
              : linked.isError
                ? "That export link isn't valid for this site."
                : "Checking the export…"}
          </span>
          <span className="flex gap-3">
            {linked.data?.status === "done" ? (
              <button type="button" onClick={() => void download(`/api/exports/${linked.data!.id}/file`, "energy.csv")} className="h-8 rounded-lg border border-app-ln px-3 text-app-tx">
                Download
              </button>
            ) : null}
            <button type="button" onClick={() => setParams({}, { replace: true })} className="text-app-sb">
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      <div className="flex justify-between gap-4 text-[13px]">
        <span className="font-medium" data-testid="range-text">
          {s ? `${rangeText(s.from, s.to)} · ${s.days} day${s.days > 1 ? "s" : ""} · ${RES_LABEL[s.res]}` : "Loading…"}
        </span>
        <span className="text-app-dm">
          {s ? `Data from ${rangeText(s.dataStart, s.dataStart)} to today · 15-min totals kept permanently, 5-second readings for 13 months` : ""}
        </span>
      </div>
      {warnings.length ? (
        <div role="note" className="rounded-xl border border-[rgba(242,179,61,.35)] bg-[rgba(242,179,61,.08)] px-4 py-3 text-[13px] text-tag-pv">
          {warnings.join(" ")}
        </div>
      ) : null}

      <div className={cn("grid gap-3", cards.length === 5 ? "grid-cols-5" : "grid-cols-4")} aria-label="Totals" role="list">
        {cards.map((c) => (
          <div key={c.label} role="listitem" className="flex flex-col gap-1.5 rounded-[14px] border border-app-l2 bg-app-ps px-4 py-3.5">
            <span className="flex items-center gap-2 text-xs text-app-sb">
              <span className="h-2 w-2 rounded-full" style={{ background: c.colour }} aria-hidden />
              {c.label}
            </span>
            <span className="text-[22px] font-semibold tabular-nums">{c.value}</span>
            <span className="min-h-4 text-xs text-app-dm">{c.delta}</span>
          </div>
        ))}
      </div>

      <section aria-label="Chart" className="flex flex-col gap-4 rounded-[14px] border border-app-l2 bg-app-ps p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1" role="group" aria-label="View">
            {(Object.keys(VIEWS) as View[])
              .filter((k) => money || k !== "cost")
              .map((k) => (
                <button key={k} type="button" aria-pressed={shownView === k} onClick={() => setView(k)} className={chip(shownView === k)}>
                  {VIEWS[k].label}
                </button>
              ))}
          </div>
          <div className="flex flex-wrap gap-3.5 text-xs text-app-sb">
            {VIEWS[shownView].keys.map(([k, label, colour]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} aria-hidden />
                {label}
              </span>
            ))}
            {s?.buckets.some((b) => b.estimated) ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm border-[1.5px] border-dashed border-app-sb" aria-hidden />
                Estimated
              </span>
            ) : null}
          </div>
        </div>
        {s ? <HistoryChart buckets={s.buckets} res={s.res} view={shownView} tz={tz} capKw={snap?.site.demandCapKw ?? null} currency={currency} /> : <div className="h-[260px]" aria-busy="true" />}
        {s?.buckets.some((b) => b.estimated) ? (
          <p className="m-0 text-xs text-app-sb">Dashed bars include estimated intervals: a meter was offline, so its readings were estimated from the other devices.</p>
        ) : null}
        {series.isError ? <p className="m-0 text-[13px] text-app-sb">History couldn't be loaded: {series.error.message}</p> : null}
      </section>

      <Reports from={s?.from ?? range.from} to={s?.to ?? range.to} role={role} email={me?.email ?? ""} builderOpen={builderOpen} onCloseBuilder={() => setBuilderOpen(false)} />
    </PageFrame>
  )
}
