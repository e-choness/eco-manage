import { useRef, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { siteDate, type BillDetail, type BillSummary } from "@ecomanage/shared"
import { enterUtilityTotal, getBill, uploadUtilityBill } from "@/api/bills"
import { download } from "@/api/files"
import { useCsvExport } from "@/hooks/useCsvExport"
import { useToast } from "@/hooks/useToast"
import { clockAt, money } from "@/lib/format"
import { rangeText } from "../history/dates"
import { lastLocalDay, monthLabel } from "./labels"

const button = "h-[34px] rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx disabled:opacity-70"
const kwh = (x: number) => `${Math.round(x).toLocaleString("en-US")} kWh`

/** The selected billing period (App v2 Bills, right): lines, facts, utility bill and downloads. */
export function BillPanel({ bill, tz, currency, canUpload }: { bill: BillSummary; tz: string; currency: string; canUpload: boolean }) {
  const detail = useQuery({
    queryKey: ["bill", bill.period],
    queryFn: () => getBill(bill.period),
    // While the worker reads an uploaded bill, look again every 2 s.
    refetchInterval: (q) => ((q.state.data as BillDetail | undefined)?.utility?.status === "processing" ? 2000 : false),
  })
  const navigate = useNavigate()
  const csv = useCsvExport()
  const { toast } = useToast()
  const d = detail.data ?? null
  const from = siteDate(new Date(bill.start), tz)
  const to = lastLocalDay(bill.end, tz)
  const soFar = bill.inProgress ? siteDate(new Date(), tz) : to
  const m = (c: number) => money(c, currency)
  const L = bill.lines
  const rate = d?.tariff ? `$${(d.tariff.demandRateCents / 100).toFixed(2)}` : null
  const lines: [string, number, string][] = [
    ["Energy · peak", L.energyPkCents, "#ff7a59"],
    ["Energy · mid", L.energyMdCents, "#9aa7bd"],
    ["Energy · off-peak", L.energyOpCents, "#5b9dff"],
    [`Demand · ${Math.round(bill.peakKw)} kW${rate ? ` × ${rate}` : ""}`, L.demandCents, "#b48cff"],
    ["Fixed fees", L.fixedCents, "var(--dm)"],
    ["Export credit", -L.exportCreditCents, "#3ecf8e"],
  ]
  const maxLine = Math.max(1, ...lines.map(([, c]) => Math.abs(c)))
  const statement = async () => {
    try {
      await download(`/api/bills/${bill.period}/statement`, `statement-${bill.period}.pdf`)
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error ? err.message : "The statement couldn't be made." })
    }
  }

  return (
    <aside aria-label={`Bill ${monthLabel(bill.period)}`} className="sticky top-0 flex flex-col gap-4 rounded-[14px] border border-app-l2 bg-app-ps p-[22px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-app-sb">{rangeText(from, soFar)}</span>
          <h2 className="m-0 text-xl font-semibold">
            {monthLabel(bill.period)}
            {bill.inProgress ? " · so far" : ""}
          </h2>
        </div>
        <span className="rounded-md bg-app-ch px-2 py-[3px] text-[11px] text-app-sb">{bill.inProgress ? "estimate · in progress" : "our estimate"}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[40px] font-semibold leading-none tabular-nums" data-testid="bill-total">
          {m(bill.totalCents)}
        </span>
        {bill.projectedCents != null ? (
          <span className="text-[13px] text-app-sb">
            heading for <span className="font-semibold text-app-tx">{m(bill.projectedCents)}</span>
          </span>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Bill lines">
        {lines.map(([label, cents, colour]) => (
          <li key={label} className="grid grid-cols-[minmax(0,1fr)_130px_80px] items-center gap-3 border-t border-app-l2 py-[9px] text-sm">
            <span>{label}</span>
            <span className="relative h-1.5 overflow-hidden rounded-[3px] bg-app-tr" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${(Math.abs(cents) / maxLine) * 100}%`, background: colour }} />
            </span>
            <span className="text-right tabular-nums">{m(cents)}</span>
          </li>
        ))}
      </ul>
      {d ? (
        <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-y-2 text-[13px]">
          <dt className="text-app-dm">Billing period</dt>
          <dd className="m-0">{rangeText(from, to)}</dd>
          <dt className="text-app-dm">Tariff</dt>
          <dd className="m-0">
            {d.tariff ? `Version ${d.tariff.version} · demand ${rate}/kW` : "No tariff"}
            {d.tariffVersions.length > 1 ? ` (energy priced with versions ${d.tariffVersions.join(", ")})` : ""}
          </dd>
          <dt className="text-app-dm">Peak interval</dt>
          <dd className="m-0">{bill.peakAt ? `${Math.round(bill.peakKw)} kW · ${rangeText(siteDate(new Date(bill.peakAt), tz), siteDate(new Date(bill.peakAt), tz))} ${clockAt(bill.peakAt, tz)}` : "—"}</dd>
          <dt className="text-app-dm">Bought from grid</dt>
          <dd className="m-0">{kwh(d.gridKwh)}</dd>
          <dt className="text-app-dm">Estimated data</dt>
          <dd className="m-0">
            {d.estimated.length
              ? d.estimated
                  .slice(0, 3)
                  .map((r) => `${rangeText(siteDate(new Date(r.start), tz), siteDate(new Date(r.start), tz)).replace(/ \d{4}$/, "")} ${clockAt(r.start, tz)}–${clockAt(r.end, tz)}`)
                  .join(", ") + (d.estimated.length > 3 ? ` and ${d.estimated.length - 3} more` : "")
              : "None"}
          </dd>
          <dt className="text-app-dm">Saved</dt>
          <dd className="m-0">{bill.savedCents != null ? `${m(bill.savedCents)} vs buying all energy from the grid` : "Measured after 7 days of data"}</dd>
        </dl>
      ) : (
        <div className="h-36" aria-busy="true" />
      )}
      <Utility bill={d ?? bill} currency={currency} canUpload={canUpload} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void statement()} className={button}>
          Statement (PDF)
        </button>
        <button type="button" onClick={() => void csv.run(from, soFar)} disabled={csv.busy} className={button}>
          {csv.busy ? "Preparing CSV…" : "15-min data (CSV)"}
        </button>
        <button type="button" onClick={() => navigate(`/history?from=${from}&to=${soFar}`)} className={button}>
          Open in History
        </button>
      </div>
    </aside>
  )
}

function Utility({ bill, currency, canUpload }: { bill: BillSummary; currency: string; canUpload: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [typing, setTyping] = useState(false)
  const [total, setTotal] = useState("")
  const [error, setError] = useState("")
  const u = bill.utility
  const m = (c: number) => money(c, currency)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["bill", bill.period] })
    void queryClient.invalidateQueries({ queryKey: ["bills"] })
  }

  const upload = async (f: File | undefined) => {
    if (!f) return
    setError("")
    try {
      await uploadUtilityBill(bill.period, f)
      toast({ description: "Reading the utility bill…" })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file couldn't be uploaded.")
    } finally {
      if (file.current) file.current.value = ""
    }
  }
  const enter = async (e: FormEvent) => {
    e.preventDefault()
    const cents = Math.round(Number(total.replace(/[$,\s]/g, "")) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return setError("Enter the bill's total, e.g. 3418.20")
    try {
      await enterUtilityTotal(bill.period, cents)
      setTyping(false)
      toast({ description: "Utility total saved and compared." })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The total couldn't be saved.")
    }
  }

  const text = bill.inProgress
    ? "The utility bill arrives after the period closes."
    : u?.status === "processing"
      ? "Reading the uploaded bill…"
      : u?.status === "failed"
        ? `Couldn't read ${u.fileName ?? "the uploaded bill"}: ${u.error ?? "no total found"}. Try another file or type the total.`
        : u?.totalCents != null
          ? `Utility bill ${m(u.totalCents)} · our estimate ${m(bill.totalCents)} · difference ${m(u.diffCents ?? bill.totalCents - u.totalCents)}`
          : "No utility bill uploaded for this period."
  const offer = canUpload && !bill.inProgress && (!u || u.status === "failed")

  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-app-bg px-3.5 py-3">
      <div className="flex items-center justify-between gap-3.5">
        <span className="text-[13px] text-app-sb" data-testid="utility-text">
          {text}
        </span>
        {offer ? (
          <span className="flex flex-none gap-2">
            <input ref={file} type="file" accept=".pdf,.csv,application/pdf,text/csv" className="hidden" aria-label="Utility bill file" onChange={(e) => void upload(e.target.files?.[0])} />
            <button type="button" onClick={() => file.current?.click()} className={button}>
              Upload utility bill
            </button>
            {!typing ? (
              <button type="button" onClick={() => setTyping(true)} className="p-0 text-[13px] text-tag-grid">
                Type the total
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {typing ? (
        <form onSubmit={enter} className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-app-sb">
            Total on the utility bill
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="3418.20" className="h-9 w-40 rounded-lg border border-app-ln bg-app-ps px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          <button type="submit" className={button}>
            Save
          </button>
          <button type="button" onClick={() => setTyping(false)} className="h-[34px] px-2 text-[13px] text-app-sb">
            Cancel
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-xs text-tag-hp">
          {error}
        </p>
      ) : null}
    </div>
  )
}
