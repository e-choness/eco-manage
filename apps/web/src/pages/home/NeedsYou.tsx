import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { InboxItem, Role } from "@ecomanage/shared"
import { approveRecommendation, declineRecommendation, getOpenInbox } from "@/api/home"
import { INBOX_LIST_KEY, useInboxCounts } from "@/hooks/useSiteStream"
import { useToast } from "@/hooks/useToast"
import { clockAt } from "./format"

const SHOWN = 5
const card = "flex flex-col gap-2 rounded-[14px] border border-app-ln bg-app-pn px-[18px] py-4 backdrop-blur-[14px]"

/**
 * Home, right column: the top of the Inbox. Decisions can be approved or declined here; alerts
 * link to their device. Commands waiting or running show as one line.
 */
export function NeedsYou({ tz, role }: { tz: string; role: Role | null }) {
  const navigate = useNavigate()
  const counts = useInboxCounts().data
  const inbox = useQuery({ queryKey: [...INBOX_LIST_KEY, "home"], queryFn: () => getOpenInbox(40) })
  const items = inbox.data?.items ?? []
  const needs = items.filter((i) => i.type !== "active").slice(0, SHOWN)
  const active = items.filter((i) => i.type === "active")
  const total = counts ? counts.open.decide + counts.open.alert : needs.length
  const activeCount = counts?.open.active ?? active.length
  const names = [...new Set(active.map((a) => a.deviceName).filter(Boolean))].join(", ")

  return (
    <section aria-labelledby="needs-you" className="absolute bottom-6 right-6 top-6 flex w-[360px] flex-col gap-3 overflow-auto">
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 id="needs-you" className="m-0 text-[15px] font-semibold">
          Needs you
        </h2>
        <span className="text-xs text-app-sb" data-testid="needs-count">
          {total === 1 ? "1 item" : `${total} items`}
        </span>
      </div>
      {activeCount > 0 ? (
        <button
          type="button"
          onClick={() => navigate("/inbox?type=active")}
          className="flex items-center gap-2 rounded-[10px] border border-[rgba(62,207,142,.3)] bg-app-pn px-3.5 py-2.5 text-left text-[13px] text-app-tx"
        >
          <span className="h-[7px] w-[7px] rounded-full bg-[#3ecf8e]" aria-hidden />
          {activeCount} active{names ? `: ${names}` : ""} · view
        </button>
      ) : null}
      {inbox.isError ? <p className="m-0 px-1 text-[13px] text-app-sb">The Inbox couldn't be loaded. It will retry.</p> : null}
      {needs.map((item) =>
        item.type === "decide" ? (
          <Decision key={item.key} item={item} tz={tz} canDecide={role === "owner" || role === "manager"} />
        ) : (
          <article key={item.key} className={card} aria-label={item.title}>
            <div className="flex justify-between text-xs">
              <span className={item.kind === "Info" ? "text-tag-grid" : "text-tag-hp"}>{item.kind === "Info" ? "Info" : "Alert"}</span>
              <span className="text-app-sb">{clockAt(item.at, tz)}</span>
            </div>
            <h3 className="m-0 text-[15px] font-semibold">{item.title}</h3>
            <p className="m-0 text-[13px] text-app-sb">{item.sub}</p>
            {item.deviceId ? (
              <button type="button" onClick={() => navigate(`/devices?device=${item.deviceId}`)} className="mt-0.5 self-start p-0 text-[13px] text-tag-grid">
                Open device
              </button>
            ) : null}
          </article>
        )
      )}
      {inbox.isSuccess && needs.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-app-ln p-[18px] text-[13px] text-app-sb">Nothing needs you right now.</div>
      ) : null}
    </section>
  )
}

function Decision({ item, tz, canDecide }: { item: InboxItem; tz: string; canDecide: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const done = async (message: string) => {
    toast({ description: message })
    await queryClient.invalidateQueries({ queryKey: ["inbox"] })
  }
  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError("")
    try {
      await run()
      await done(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
      setBusy(false)
    }
  }
  const decline = (e: FormEvent) => {
    e.preventDefault()
    if (reason.trim().length < 3) return setError("Say why, so the rule can be tuned.")
    void act(() => declineRecommendation(item.id, reason.trim()), "Declined. Nothing was sent.")
  }

  return (
    <article className={card} aria-label={item.title}>
      <div className="flex justify-between text-xs">
        <span className="text-tag-bat">Decision{item.deviceName ? ` · ${item.deviceName}` : ""}</span>
        {item.due ? <span className="text-app-sb">by {clockAt(item.due, tz)}</span> : null}
      </div>
      <h3 className="m-0 text-[15px] font-semibold">{item.title}</h3>
      <p className="m-0 text-[13px] leading-normal text-app-sb">{item.sub}</p>
      {!canDecide ? (
        <p className="m-0 mt-0.5 text-xs text-app-dm">Needs a manager or owner to approve</p>
      ) : declining ? (
        <form onSubmit={decline} className="mt-1 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-app-sb">
            Why not? It helps tune the rule.
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              autoFocus
              className="h-9 rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="h-[34px] rounded-lg border border-app-ln px-3 text-[13px] font-medium text-app-tx">
              Decline
            </button>
            <button type="button" onClick={() => setDeclining(false)} className="h-[34px] px-2 text-[13px] text-app-sb">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => approveRecommendation(item.id), `Approved. ${item.deviceName ?? "The device"} gets the command when its window starts.`)}
            className="h-[34px] rounded-lg bg-[#3ecf8e] px-3.5 text-[13px] font-semibold text-[#06140d] disabled:opacity-70"
          >
            Approve
          </button>
          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className="h-[34px] rounded-lg border border-app-ln px-3 text-[13px] font-medium text-app-tx">
            Decline
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 text-xs text-[#ff7a59]">
          {error}
        </p>
      ) : null}
    </article>
  )
}
