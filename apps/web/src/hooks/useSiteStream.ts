import { createContext, useContext } from "react"
import { useQuery } from "@tanstack/react-query"
import { getInboxCounts } from "@/api/me"

export const SNAPSHOT_KEY = ["site", "snapshot"] as const
export const INBOX_COUNTS_KEY = ["inbox", "counts"] as const
export const INBOX_LIST_KEY = ["inbox", "list"] as const

export interface SiteStreamState {
  connected: boolean
  lastEventAt: number | null
}

// One SSE connection per signed-in app (SiteStreamProvider in the shell) feeds the query cache:
// the snapshot, and the Inbox counts and list.
export const SiteStreamContext = createContext<SiteStreamState>({ connected: false, lastEventAt: null })

export const useSiteStream = () => useContext(SiteStreamContext)

/** Open and closed Inbox counts: loaded once, then kept current by `inbox` stream events. */
export const useInboxCounts = () => useQuery({ queryKey: INBOX_COUNTS_KEY, queryFn: getInboxCounts, staleTime: Infinity })
