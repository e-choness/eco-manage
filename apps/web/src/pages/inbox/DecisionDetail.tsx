import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { RecommendationDetail, Role } from "@ecomanage/shared"
import { approveRecommendation, checkRecommendation, declineRecommendation, getCommand, getRecommendation } from "@/api/inbox"
import { getDevice } from "@/api/devices"
import { useToast } from "@/hooks/useToast"
import { clockAt, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Btn, Header, Payload, Section, Timeline } from "./parts"
import { DECLINE_REASONS, KIND } from "./labels"

const CHECK_DEBOUNCE_MS = 300
const PARAM_LABEL: Record<string, string> = { kw: "Power", pct: "Reserve", amps: "Current", limit_kw: "Export limit" }

/** Where the approved command is: a step of the decision timeline. */
const commandStep: Record<string, number> = { created: 2, sent: 3, acked: 3, verified: 4, reverted: 5, failed: 3, cancelled: 5 }

/**
 * A decision (App v2 Inbox): why it was suggested, the checks against the site's limits, the
 * saving, what approving sends, and approve / decline. Sliders re-run the checks as they move.
 */
export function DecisionDetail({ id, tz, currency, role }: { id: string; tz: string; currency: string; role: Role | null }) {
  const rec = useQuery({ queryKey: ["recommendation", id], queryFn: () => getRecommendation(id) })
  const r = rec.data
  if (!r) return <p className="m-0 text-[13px] text-app-sb">{rec.isError ? `This decision couldn't be loaded: ${rec.error.message}` : "Loading…"}</p>
  return <Loaded key={r.id + r.status} r={r} tz={tz} currency={currency} role={role} />
}

function Loaded({ r, tz, currency, role }: { r: RecommendationDetail; tz: string; currency: string; role: Role | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const pending = r.status === "proposed"
  const device = useQuery({ queryKey: ["device", r.deviceId], queryFn: () => getDevice(r.deviceId), enabled: pending && r.canApprove })
  const command = useQuery({ queryKey: ["command", r.commandId], queryFn: () => getCommand(r.commandId!), enabled: !!r.commandId })
  const spec = device.data?.profile?.actions.find((a) => a.id === r.action)
  const sliders = useMemo(
    () => Object.entries(spec?.params ?? {}).filter(([name, p]) => (p.type === "number" || p.type === "integer") && p.min !== undefined && p.max !== undefined && typeof r.params[name] === "number"),
    [spec, r.params]
  )
  const [params, setParams] = useState<Record<string, unknown>>(r.params)
  const changed = JSON.stringify(params) !== JSON.stringify(r.params)
  const [checked, setChecked] = useState<{ checks: RecommendationDetail["checks"]; expectedSavingCents: number; calc: string } | null>(null)
  const [reason, setReason] = useState(DECLINE_REASONS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Re-check 300 ms after the last slider move.
  useEffect(() => {
    if (!changed) return
    let live = true
    const t = setTimeout(() => {
      checkRecommendation(r.id, params)
        .then((c) => live && setChecked(c))
        .catch((err: Error) => live && setError(err.message))
    }, CHECK_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [params, changed, r.id])

  // A check only counts while the settings still differ from the proposal.
  const liveCheck = changed ? checked : null
  const checks = liveCheck?.checks ?? r.checks
  const saving = liveCheck?.expectedSavingCents ?? r.expectedSavingCents
  const calc = liveCheck?.calc ?? r.calc
  const allPass = checks.every((c) => c.pass)
  const settled = !changed || liveCheck !== null
  const cmd = command.data
  const span = `${clockAt(r.window.start, tz)}–${clockAt(r.window.end, tz)}`

  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError("")
    try {
      await run()
      toast({ description: message })
      void queryClient.invalidateQueries({ queryKey: ["inbox"] })
      void queryClient.invalidateQueries({ queryKey: ["recommendation", r.id] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
    } finally {
      setBusy(false)
    }
  }

  const status = pending
    ? { text: `Waiting for approval · expires ${clockAt(r.expiresAt, tz)}`, className: "text-tag-pv" }
    : r.status === "declined"
      ? { text: `Declined by ${r.decidedBy?.name ?? "someone"}`, className: "text-app-sb" }
      : r.status === "expired"
        ? { text: "Expired: nobody decided in time", className: "text-app-sb" }
        : { text: `Approved by ${r.decidedBy?.name ?? "someone"}${cmd ? ` · command ${cmd.status}` : ""}`, className: "text-tag-bat" }
  const closed = r.status === "declined" || r.status === "expired"
  const who = r.ruleId === "manual" ? "a manual request" : `rule “${r.ruleTitle}”`
  const steps: [string, string][] = closed
    ? [
        [`Proposed by ${who}`, clockAt(r.proposedAt, tz)],
        [r.status === "declined" ? `Declined by ${r.decidedBy?.name ?? "someone"}` : "Expired", r.decidedAt ? clockAt(r.decidedAt, tz) : clockAt(r.expiresAt, tz)],
      ]
    : [
        [`Proposed by ${who}`, clockAt(r.proposedAt, tz)],
        [pending ? "Approval" : `Approved by ${r.decidedBy?.name ?? "someone"}`, pending ? `expires ${clockAt(r.expiresAt, tz)}` : r.decidedAt ? clockAt(r.decidedAt, tz) : ""],
        ["Sent to the gateway", cmd?.sentAt ? clockAt(cmd.sentAt, tz) : cmd?.sendAt ? `at ${clockAt(cmd.sendAt, tz)}` : ""],
        [`Confirmed by ${r.deviceName ?? "the device"}`, cmd?.ackedAt ? clockAt(cmd.ackedAt, tz) : ""],
        ["Ends and goes back to default", cmd?.revertedAt ? clockAt(cmd.revertedAt, tz) : r.payload.revertAt ? `at ${clockAt(r.payload.revertAt, tz)}` : ""],
        ["Actual saving measured", "next day"],
      ]
  const current = closed ? 2 : pending ? 1 : cmd ? commandStep[cmd.status] ?? 2 : 2

  return (
    <div className="flex flex-col gap-4">
      <Header
        kind={pending ? "Decision" : closed ? "Closed" : "Active"}
        kindClass={KIND[pending ? "Decision" : closed ? "Closed" : "Active"]}
        status={status.text}
        statusClass={status.className}
        title={r.title}
        sub={`${r.deviceName ?? "Device"} · ${span} · proposed by ${who}.`}
      />

      {pending && r.canApprove
        ? sliders.map(([name, p]) => (
            <label key={name} className="flex flex-col gap-1.5 rounded-[10px] bg-app-bg px-3.5 py-3 text-[13px]">
              <span className="flex justify-between">
                <span className="text-app-sb">{PARAM_LABEL[name] ?? name}</span>
                <span className="font-semibold tabular-nums">
                  {String(params[name])} {p.unit ?? ""}
                </span>
              </span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.unit === "%" ? 5 : 1}
                value={Number(params[name])}
                onChange={(e) => setParams({ ...params, [name]: Number(e.target.value) })}
              />
              <span className="text-xs text-app-dm">Checks and saving update as you move it.</span>
            </label>
          ))
        : null}

      <Section title="Why it was suggested" rows={[["Rule", r.ruleId === "manual" ? "Manual request (Devices page)" : `${r.ruleTitle} · runs every 15 min`], ["Window", span], ...r.inputs.map((i): [string, string] => [i.label, i.value])]} />
      <Section title="Checks against your limits" rows={checks.map((c): [string, string, string] => [c.pass ? "Pass" : "Fails", c.text, c.pass ? "text-tag-bat" : "text-tag-hp"])} />
      <Section title={`Expected saving ${money(saving, currency)}`} text={calc} />
      {pending ? (
        <Section
          title="How it gets decided"
          rows={[
            ["Who can approve", r.canApprove ? "You (Settings → Rules → Who can approve)" : "See Settings → Rules → Who can approve"],
            ["Deadline", clockAt(r.expiresAt, tz)],
            ["If nobody decides", "It expires and nothing is sent"],
          ]}
        />
      ) : null}
      {closed ? (
        <Section
          title="Outcome"
          rows={[
            ["Result", r.status === "declined" ? "Declined" : "Expired"],
            ["Reason", r.declineReason ?? "—"],
            ["Decided by", r.decidedBy?.name ?? "nobody"],
          ]}
          text={r.status === "declined" ? "Nothing was sent. The reason is kept so the rule can be tuned. If the same rule is declined often for the same reason, it shows up in Settings → Rules." : undefined}
        />
      ) : null}
      {!closed ? <Payload title={pending ? "Sent to the gateway if approved" : "Sent to the gateway"} value={{ ...r.payload, params: pending ? params : r.payload.params }} /> : null}
      <Timeline steps={steps} current={current} />

      {pending && r.canApprove ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-app-l2 pt-3.5">
          <select aria-label="Reason if you decline" value={reason} onChange={(e) => setReason(e.target.value)} className="h-[34px] rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx">
            {DECLINE_REASONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <Btn onClick={() => void act(() => declineRecommendation(r.id, reason), "Declined. Nothing was sent.")} disabled={busy}>
            Decline
          </Btn>
          <Btn
            primary
            disabled={busy || !allPass || !settled}
            title={allPass ? undefined : "A limit check fails"}
            onClick={() => void act(() => approveRecommendation(r.id, changed ? params : undefined), `Approved. ${r.deviceName ?? "The device"} gets the command at ${clockAt(r.window.start, tz)}.`)}
          >
            Approve
          </Btn>
        </div>
      ) : null}
      {pending && r.canApprove && !allPass ? <p className={cn("m-0 text-xs text-app-sb")}>Approve is off because a limit check fails. Change the value, or the limit in Settings → Rules.</p> : null}
      {pending && !r.canApprove ? (
        <p className="m-0 text-xs text-app-sb">{role === "installer" ? "Installers can see proposals but can’t approve them." : "Only the owner can approve this site’s proposals (Settings → Rules → Who can approve)."}</p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-xs text-tag-hp">
          {error}
        </p>
      ) : null}
    </div>
  )
}
