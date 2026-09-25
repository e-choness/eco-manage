import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { SiteEvent, SiteSnapshot } from "@ecomanage/shared"
import { getSnapshot } from "@/api/site"
import { authHeader, refreshSession } from "@/api/api"
import { applySiteEvent, createSseParser } from "@/lib/siteLive"

export const SNAPSHOT_KEY = ["site", "snapshot"] as const
const RETRY_MS = 3000

/**
 * The site's live view: the snapshot from GET /api/site/snapshot, kept current by the SSE stream.
 * EventSource can't send an Authorization header, so the stream is read with fetch. On 401 the
 * session is refreshed once; on any drop it reconnects and starts again from a fresh snapshot.
 */
export function useSiteLive() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: SNAPSHOT_KEY, queryFn: getSnapshot })
  const [connected, setConnected] = useState(false)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)

  useEffect(() => {
    let stopped = false
    let controller: AbortController | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const onEvent = createSseParser(({ event, data }) => {
      setLastEventAt(Date.now())
      if (event === "snapshot") {
        queryClient.setQueryData(SNAPSHOT_KEY, data as SiteSnapshot)
        return
      }
      queryClient.setQueryData<SiteSnapshot>(SNAPSHOT_KEY, (current) => (current ? applySiteEvent(current, data as SiteEvent) : current))
    })

    const connect = async (refreshed = false): Promise<void> => {
      if (stopped) return
      controller = new AbortController()
      try {
        const res = await fetch("/api/site/stream", { headers: authHeader(), credentials: "include", signal: controller.signal })
        if (res.status === 401 && !refreshed && (await refreshSession())) return connect(true)
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        setConnected(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          onEvent(decoder.decode(value, { stream: true }))
        }
      } catch {
        // fall through to reconnect
      }
      setConnected(false)
      if (!stopped) retry = setTimeout(() => void connect(), RETRY_MS)
    }

    void connect()
    return () => {
      stopped = true
      controller?.abort()
      if (retry) clearTimeout(retry)
    }
  }, [queryClient])

  return { ...query, connected, lastEventAt }
}
