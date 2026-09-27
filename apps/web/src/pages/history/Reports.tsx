import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { REPORT_SCHEDULE_LABEL, REPORT_SECTIONS, REPORT_SECTION_LABEL, type ReportSection, type ReportView, type Role } from "@ecomanage/shared"
import { createReport, deleteReport, getReports } from "@/api/history"
import { download } from "@/api/files"
import { useToast } from "@/hooks/useToast"
import { cn } from "@/lib/utils"
import { rangeText } from "./dates"

const input = "h-9 rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-app-dm"
const DEFAULT_SECTIONS: ReportSection[] = ["summary", "sources", "demand", "cost", "decisions"]
const STATUS: Record<ReportView["status"], string> = { waiting: "Waiting to be generated", ready: "Ready", failed: "Failed to generate" }

/** History → Reports (App v2): the builder for the range on screen, and the reports made so far. */
export function Reports({ from, to, role, email, builderOpen, onCloseBuilder }: { from: string; to: string; role: Role | null; email: string; builderOpen: boolean; onCloseBuilder: () => void }) {
  const reports = useQuery({ queryKey: ["reports"], queryFn: getReports })
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const remove = async (r: ReportView) => {
    try {
      await deleteReport(r.id)
      toast({ description: r.schedule === "once" ? "Report removed." : "Report removed. Its schedule has stopped." })
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error ? err.message : "The report couldn't be removed." })
    }
  }

  return (
    <section aria-labelledby="reports" className="flex flex-col gap-3.5 rounded-[14px] border border-app-l2 bg-app-ps p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="reports" className="m-0 text-[15px] font-semibold">
          Reports
        </h2>
        <span className="text-xs text-app-sb">Built from the same 15-min data. Scheduled reports are emailed to the recipients.</span>
      </div>
      {builderOpen ? (
        <Builder
          key={`${from}${to}`}
          from={from}
          to={to}
          role={role}
          email={email}
          onDone={() => {
            onCloseBuilder()
            void queryClient.invalidateQueries({ queryKey: ["reports"] })
          }}
          onCancel={onCloseBuilder}
        />
      ) : null}
      {reports.data?.items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {reports.data.items.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1.6fr)_60px_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-t border-app-l2 py-3 text-[13px]">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.name}</span>
                <span className="text-xs text-app-dm">{rangeText(r.from, r.to)}</span>
              </span>
              <span className="font-mono text-xs uppercase text-app-sb">{r.format}</span>
              <span className="text-app-sb">{REPORT_SCHEDULE_LABEL[r.schedule]}</span>
              <span className="truncate text-app-sb">
                {r.createdBy?.name ?? "—"} · {rangeText(r.createdAt.slice(0, 10), r.createdAt.slice(0, 10))}
              </span>
              <span className="flex items-center gap-3">
                {r.status === "ready" ? (
                  <button type="button" onClick={() => void download(`/api/reports/${r.id}/file`, `${r.name}.${r.format}`)} className="h-8 rounded-lg border border-app-ln px-3 text-[13px] text-app-tx">
                    Download
                  </button>
                ) : (
                  <span className={cn("text-xs", r.status === "failed" ? "text-tag-hp" : "text-app-dm")}>{STATUS[r.status]}</span>
                )}
                {r.canDelete ? (
                  <button type="button" onClick={() => void remove(r)} className="p-0 text-xs text-app-sb hover:text-app-tx" aria-label={`Remove ${r.name}`}>
                    Remove
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-app-sb">{reports.isLoading ? "Loading reports…" : "No reports yet. Create one for the range above."}</p>
      )}
    </section>
  )
}

function Builder({ from, to, role, email, onDone, onCancel }: { from: string; to: string; role: Role | null; email: string; onDone: () => void; onCancel: () => void }) {
  const { toast } = useToast()
  const sections = REPORT_SECTIONS.filter((s) => !(role === "installer" && s === "cost"))
  const [name, setName] = useState("")
  const [format, setFormat] = useState<"pdf" | "csv" | "xlsx">("pdf")
  const [schedule, setSchedule] = useState<"once" | "weekly" | "monthly">("once")
  const [recipients, setRecipients] = useState(email)
  const [picked, setPicked] = useState<ReportSection[]>(DEFAULT_SECTIONS.filter((s) => sections.includes(s)))
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const placeholder = `Energy report · ${rangeText(from, to)}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      await createReport({
        name: name.trim() || placeholder,
        from,
        to,
        sections: picked,
        format,
        schedule,
        recipients: recipients.split(/[,;\s]+/).filter(Boolean),
        notes,
      })
      toast({ description: schedule === "once" ? "Report saved." : `Report saved. Copies go to ${recipients} (${REPORT_SCHEDULE_LABEL[schedule]}).` })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report couldn't be saved.")
      setBusy(false)
    }
  }

  const toggle = (s: ReportSection) => setPicked(picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s])

  return (
    <form onSubmit={submit} aria-label="Create report" className="flex flex-col gap-3.5 rounded-xl border border-app-ln bg-app-bg p-4">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_110px_160px_minmax(0,1.4fr)] gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={120} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Period
          <input value={rangeText(from, to)} disabled className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className={input}>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Schedule
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)} className={input}>
            {(["once", "weekly", "monthly"] as const).map((s) => (
              <option key={s} value={s}>
                {REPORT_SCHEDULE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Recipients
          <input value={recipients} onChange={(e) => setRecipients(e.target.value)} className={input} />
        </label>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[13px] text-app-sb">Sections</legend>
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => {
            const on = picked.includes(s)
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s)}
                className={cn("h-8 rounded-full border px-3 text-[13px]", on ? "border-[rgba(62,207,142,.5)] bg-app-ch text-app-tx" : "border-app-ln text-app-sb")}
              >
                {REPORT_SECTION_LABEL[s]}
              </button>
            )
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-[13px] text-app-sb">
        Notes for readers
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="rounded-lg border border-app-ln bg-app-bg px-2.5 py-2 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      {error ? (
        <p role="alert" className="m-0 text-xs text-[#ff7a59]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-[34px] px-3 text-[13px] text-app-sb">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-[34px] rounded-lg bg-[#3ecf8e] px-4 text-[13px] font-semibold text-[#06140d] disabled:opacity-70">
          {busy ? "Saving…" : "Generate"}
        </button>
      </div>
    </form>
  )
}
