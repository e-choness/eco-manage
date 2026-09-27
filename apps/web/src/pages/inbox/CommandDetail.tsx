import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { CommandView, Role } from "@ecomanage/shared"
import { cancelCommand, getCommand } from "@/api/inbox"
import { useToast } from "@/hooks/useToast"
import { clockAt } from "@/lib/format"
import { Btn, Header, Payload, Section, Timeline } from "./parts"
import { KIND } from "./labels"

const OPEN = ["created", "sent", "acked"]
const isOpen = (c: CommandView) => OPEN.includes(c.status) || (c.status === "verified" && !!c.revertAt && !c.revertedAt)

const statusOf = (c: CommandView, tz: string): { text: string; className: string } => {
  switch (c.status) {
    case "created":
      return { text: c.sendAt ? `Starts at ${clockAt(c.sendAt, tz)}` : "Waiting to be sent", className: "text-tag-pv" }
    case "sent":
      return { text: "Sending to the gateway…", className: "text-tag-pv" }
    case "acked":
      return { text: "Confirmed by the gateway, checking the device", className: "text-tag-pv" }
    case "verified":
      return c.revertAt && !c.revertedAt ? { text: `Running until ${clockAt(c.revertAt, tz)}`, className: "text-tag-pv" } : { text: "Done", className: "text-tag-bat" }
    case "reverted":
      return { text: "Finished: back to the device's default", className: "text-tag-bat" }
    case "failed":
      return { text: `Failed${c.error ? `: ${c.error}` : ""}`, className: "text-tag-hp" }
    default:
      return { text: "Cancelled", className: "text-app-sb" }
  }
}

/** A command waiting, running or finished (App v2 Inbox → Active / Closed). */
export function CommandDetail({ id, tz, role }: { id: string; tz: string; role: Role | null }) {
  const command = useQuery({ queryKey: ["command", id], queryFn: () => getCommand(id), refetchInterval: 15_000 })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const c = command.data
  if (!c) return <p className="m-0 text-[13px] text-app-sb">{command.isError ? `This command couldn't be loaded: ${command.error.message}` : "Loading…"}</p>

  const open = isOpen(c)
  const status = statusOf(c, tz)
  const t = (at: string | null) => (at ? clockAt(at, tz) : "")
  const steps: [string, string][] = [
    ["Waiting for its start", c.sendAt ? `at ${clockAt(c.sendAt, tz)}` : ""],
    ["Sent to the gateway", t(c.sentAt)],
    [`Confirmed by ${c.deviceName ?? "the device"}`, t(c.ackedAt)],
    ["Checked on the device's readings", t(c.verifiedAt)],
    [c.status === "cancelled" ? "Cancelled" : c.status === "failed" ? "Failed" : "Ends and goes back to default", c.cancelledAt ? t(c.cancelledAt) : c.failedAt ? t(c.failedAt) : c.revertedAt ? t(c.revertedAt) : c.revertAt ? `at ${clockAt(c.revertAt, tz)}` : ""],
  ]
  const current = { created: 0, sent: 1, acked: 2, verified: 3, reverted: 5, failed: 4, cancelled: 4 }[c.status]

  const cancel = async () => {
    setBusy(true)
    setError("")
    try {
      const after = await cancelCommand(c.id)
      toast({ description: after.revert ? `Revert sent. ${c.deviceName ?? "The device"} goes back to its default.` : "Cancelled. Nothing was sent." })
      void queryClient.invalidateQueries({ queryKey: ["command", c.id] })
      void queryClient.invalidateQueries({ queryKey: ["inbox"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "It couldn't be cancelled.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Header
        kind={open ? "Active" : "Closed"}
        kindClass={KIND[open ? "Active" : "Closed"]}
        status={status.text}
        statusClass={status.className}
        title={c.recommendation?.title ?? `${c.action.replace(/_/g, " ")} · ${c.deviceName ?? "device"}`}
        sub="The device goes back to its own default when the window ends, or if the gateway loses the cloud connection for more than 15 minutes."
      />
      <Section
        title="Command"
        rows={[
          ["Device", c.deviceName ?? c.deviceId],
          ["Action", c.action.replace(/_/g, " ")],
          ["Starts", c.sendAt ? clockAt(c.sendAt, tz) : "—"],
          ["Ends", c.revertAt ? clockAt(c.revertAt, tz) : "once done"],
          ...(c.revert ? [["Revert", `${c.revert.action.replace(/_/g, " ")} · ${c.revert.status}`] as [string, string]] : []),
        ]}
      />
      <Payload title="Sent to the gateway" value={{ deviceId: c.deviceId, action: c.action, params: c.params, expiresAt: c.expiresAt, revertAt: c.revertAt }} />
      <Timeline steps={steps} current={current} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-app-l2 pt-3.5">
        <Btn onClick={() => navigate(`/devices?device=${c.deviceId}`)}>Open device</Btn>
        {open && (role === "owner" || role === "manager") ? (
          <Btn onClick={() => void cancel()} disabled={busy}>
            Cancel early
          </Btn>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-xs text-[#ff7a59]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
