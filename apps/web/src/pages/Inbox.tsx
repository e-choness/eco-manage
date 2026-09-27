import { useSearchParams } from "react-router-dom"
import { useInfiniteQuery } from "@tanstack/react-query"
import { siteDate, type InboxItem, type InboxType } from "@ecomanage/shared"
import { getInbox } from "@/api/inbox"
import { INBOX_LIST_KEY, useInboxCounts } from "@/hooks/useSiteStream"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useMe } from "@/hooks/useMe"
import { PageFrame } from "@/shell/AppShell"
import { clockAt } from "@/lib/format"
import { cn } from "@/lib/utils"
import { INBOX_FOOT, KIND } from "./inbox/labels"
import { DecisionDetail } from "./inbox/DecisionDetail"
import { CommandDetail } from "./inbox/CommandDetail"
import { AlertDetail } from "./inbox/AlertDetail"

const TYPES: [InboxType | "all", string][] = [
  ["all", "All"],
  ["decide", "Decisions"],
  ["alert", "Alerts"],
  ["active", "Active"],
]
const chip = (on: boolean) => cn("h-8 rounded-lg px-3 text-[13px]", on ? "bg-app-ch text-app-tx" : "text-app-sb hover:text-app-tx")

/**
 * App v2 Inbox: decisions, alerts and commands in one list, open or closed, with the selected one
 * in detail. Email links (?alert=, ?recommendation=) and Home (?type=active) open straight into it.
 */
export function Inbox() {
  const [params, setParams] = useSearchParams()
  const { data: snap } = useSiteLive()
  const { role } = useMe()
  const counts = useInboxCounts().data
  const tz = snap?.site.tz ?? "UTC"
  const currency = snap?.site.currency ?? "CAD"
  const state = params.get("state") === "closed" ? "closed" : "open"
  const typeParam = params.get("type")
  const type = (TYPES.some(([t]) => t === typeParam) ? typeParam : "all") as InboxType | "all"
  const linked = params.get("alert") ? `alert:${params.get("alert")}` : params.get("recommendation") ? `decide:${params.get("recommendation")}` : null

  const list = useInfiniteQuery({
    queryKey: [...INBOX_LIST_KEY, state, type],
    queryFn: ({ pageParam }) => getInbox(state, type, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const selectedKey = params.get("item") ?? linked ?? items[0]?.key ?? null
  const [selType, selId] = selectedKey ? (selectedKey.split(":") as [InboxType, string]) : [null, null]

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const k of ["alert", "recommendation"]) next.delete(k)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }
  const today = siteDate(new Date(), tz)
  const meta = (i: InboxItem) => {
    if (i.type === "decide" && i.due && state === "open") return `by ${clockAt(i.due, tz)}`
    return siteDate(new Date(i.at), tz) === today ? clockAt(i.at, tz) : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(new Date(i.at)).replace("Sept", "Sep")
  }

  return (
    <PageFrame title="Inbox">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,540px)] items-start gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="group" aria-label="Open or closed">
              {(["open", "closed"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={state === s} onClick={() => set({ state: s === "open" ? null : s, item: null })} className={chip(state === s)}>
                  {s === "open" ? "Open" : "Closed"}
                  {counts ? ` (${counts[s][type]})` : ""}
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label="Type">
              {TYPES.map(([t, label]) => (
                <button key={t} type="button" aria-pressed={type === t} onClick={() => set({ type: t === "all" ? null : t, item: null })} className={chip(type === t)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-app-l2 bg-app-ps">
            <ul className="m-0 list-none p-0" aria-label="Inbox items">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    aria-current={i.key === selectedKey ? "true" : undefined}
                    onClick={() => set({ item: i.key })}
                    className={cn("grid w-full grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 border-b border-app-l2 px-4 py-3 text-left text-app-tx hover:bg-app-hv", i.key === selectedKey && "bg-app-hv")}
                  >
                    <span className={cn("justify-self-start rounded-md px-2 py-[3px] text-[11px] font-medium", KIND[i.kind])}>{i.kind}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{i.title}</span>
                      <span className="truncate text-xs text-app-sb">{i.sub}</span>
                    </span>
                    <span className="text-xs text-app-dm">{meta(i)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.isSuccess && !items.length ? <p className="m-0 p-6 text-center text-[13px] text-app-sb">Nothing here.</p> : null}
            {list.isError ? <p className="m-0 p-6 text-[13px] text-app-sb">The Inbox couldn't be loaded: {list.error.message}</p> : null}
            {list.hasNextPage ? (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="w-full py-3 text-[13px] text-tag-grid">
                {list.isFetchingNextPage ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </div>
          <p className="m-0 text-xs leading-normal text-app-dm">{INBOX_FOOT}</p>
        </div>

        {selId ? (
          <aside aria-label="Selected item" className="sticky top-0 rounded-[14px] border border-app-l2 bg-app-ps p-[22px]">
            {selType === "decide" ? (
              <DecisionDetail key={selId} id={selId} tz={tz} currency={currency} role={role} />
            ) : selType === "alert" ? (
              <AlertDetail key={selId} id={selId} tz={tz} />
            ) : (
              <CommandDetail key={selId} id={selId} tz={tz} role={role} />
            )}
          </aside>
        ) : (
          <div />
        )}
      </div>
    </PageFrame>
  )
}
