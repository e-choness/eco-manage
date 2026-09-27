import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ALERT_CAUSES, ALERT_RULES, FALSE_ALARM_MUTE_DAYS, type AlertCause } from "@ecomanage/shared"
import { ackAlert, fixAlert, getAlert, resolveAlert, snoozeAlert } from "@/api/inbox"
import { useToast } from "@/hooks/useToast"
import { clockAt } from "@/lib/format"
import { Btn, Header, Section, Timeline } from "./parts"
import { KIND, howItCloses } from "./labels"

/**
 * An alert (App v2 Inbox): what triggered it, how it closes, its timeline, and acknowledge, pause
 * emails, remote fixes and closing it with a cause.
 */
export function AlertDetail({ id, tz }: { id: string; tz: string }) {
  const alert = useQuery({ queryKey: ["alert", id], queryFn: () => getAlert(id) })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [closing, setClosing] = useState<AlertCause | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const a = alert.data
  if (!a) return <p className="m-0 text-[13px] text-app-sb">{alert.isError ? `This alert couldn't be loaded: ${alert.error.message}` : "Loading…"}</p>

  const open = a.state !== "resolved"
  const active = a.condition === "active"
  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError("")
    try {
      await run()
      toast({ description: message })
      setClosing(null)
      void queryClient.invalidateQueries({ queryKey: ["alert", a.id] })
      void queryClient.invalidateQueries({ queryKey: ["inbox"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }
  const close = (e: FormEvent) => {
    e.preventDefault()
    if (!closing) return
    void act(
      () => resolveAlert(a.id, closing, note),
      closing === "False alarm" ? `Closed as false alarm. This check is muted for this device for ${FALSE_ALARM_MUTE_DAYS} days.` : "Alert closed. The note is on the device's log."
    )
  }

  const status =
    a.state === "open"
      ? { text: "Open", className: "text-tag-hp" }
      : a.state === "ack"
        ? { text: `Acknowledged by ${a.ackBy?.name ?? "someone"}`, className: "text-tag-pv" }
        : { text: "Resolved", className: "text-tag-bat" }
  const steps: [string, string][] = [["Opened", clockAt(a.openedAt, tz)]]
  if (a.ackBy) steps.push([`Acknowledged by ${a.ackBy.name}`, a.ackAt ? clockAt(a.ackAt, tz) : ""])
  if (a.snoozedUntil) steps.push([`Emails paused until ${clockAt(a.snoozedUntil, tz)}`, ""])
  steps.push([a.resolution?.auto ? "Closed by itself" : "Resolved", a.resolvedAt ? clockAt(a.resolvedAt, tz) : ""])
  // Causes that fit: while the condition is still true, only a false alarm can close it.
  const causes = active ? (["False alarm"] as AlertCause[]) : ALERT_CAUSES.filter((c) => c !== "False alarm")

  return (
    <div className="flex flex-col gap-4">
      <Header
        kind={open ? (a.severity === "info" ? "Info" : "Alert") : "Closed"}
        kindClass={KIND[open ? (a.severity === "info" ? "Info" : "Alert") : "Closed"]}
        status={status.text}
        statusClass={status.className}
        title={a.title}
        sub={a.detail}
      />
      <Section
        title="What triggered it"
        rows={[
          ["Check", `${ALERT_RULES[a.ruleId].title}${ALERT_RULES[a.ruleId].kind === "condition" ? " · runs on every reading" : ""}`],
          ["Device", a.deviceName ?? "Site"],
          ["Opened", clockAt(a.openedAt, tz)],
          ["Last seen", clockAt(a.lastSeenAt, tz)],
          ...(a.count > 1 ? [["Times", String(a.count)] as [string, string]] : []),
          ["Condition", active ? "still true" : "cleared", active ? "text-tag-hp" : "text-tag-bat"],
        ]}
      />
      {open ? <Section title="How it closes" text={howItCloses(a.ruleId)} /> : null}
      {a.resolution ? (
        <Section
          title="Resolution"
          rows={[
            ["Cause", a.resolution.cause],
            ["Note", a.resolution.note || "—"],
            ["By", a.resolution.auto ? "Closed by itself" : (a.resolution.by?.name ?? "—")],
          ]}
        />
      ) : null}
      <Timeline steps={steps} current={open ? steps.length - 1 : steps.length} />

      {closing ? (
        <form onSubmit={close} aria-label="Close alert" className="flex flex-col gap-2.5 rounded-[10px] bg-app-bg p-3.5">
          <h3 className="m-0 text-[13px] font-semibold">{closing === "False alarm" ? "Close as false alarm" : "Resolve with a cause"}</h3>
          <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-2">
            <select aria-label="Cause" value={closing} onChange={(e) => setClosing(e.target.value as AlertCause)} className="h-[34px] rounded-lg border border-app-ln bg-app-ps px-2.5 text-[13px] text-app-tx">
              {causes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="What was done (saved to the device log)"
              className="h-[34px] rounded-lg border border-app-ln bg-app-ps px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <span className="text-xs text-app-dm">
            {closing === "False alarm" ? `Mutes this check for this device for ${FALSE_ALARM_MUTE_DAYS} days and flags its threshold for review.` : "The cause and note are saved to the device's maintenance log."}
          </span>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setClosing(null)}>Cancel</Btn>
            <button type="submit" disabled={busy} className="h-[34px] rounded-lg bg-[#3ecf8e] px-3.5 text-[13px] font-semibold text-[#06140d] disabled:opacity-45">
              Close alert
            </button>
          </div>
        </form>
      ) : open ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-app-l2 pt-3.5">
          {a.deviceId ? <Btn onClick={() => navigate(`/devices?device=${a.deviceId}`)}>Open device</Btn> : null}
          {a.actions.ack ? (
            <Btn disabled={busy} onClick={() => void act(() => ackAlert(a.id), "Acknowledged. The escalation email is stopped.")}>
              Acknowledge
            </Btn>
          ) : null}
          {a.actions.snooze && !a.snoozedUntil ? (
            <Btn disabled={busy} onClick={() => void act(() => snoozeAlert(a.id), "Emails paused for 24 h. The alert stays open.")}>
              Pause emails 24 h
            </Btn>
          ) : null}
          {a.actions.falseAlarm ? <Btn onClick={() => setClosing("False alarm")}>Close as false alarm</Btn> : null}
          {a.actions.fix
            ? a.fixes.map((f) => (
                <Btn key={f.id} primary disabled={busy} onClick={() => void act(() => fixAlert(a.id, f.id), `${f.label} sent. The alert closes itself if the device recovers.`)}>
                  {f.label}
                </Btn>
              ))
            : null}
          {a.actions.resolve ? (
            <Btn primary onClick={() => setClosing("Known issue")}>
              Resolve
            </Btn>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-xs text-tag-hp">
          {error}
        </p>
      ) : null}
    </div>
  )
}
