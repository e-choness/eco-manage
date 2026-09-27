import { useState } from "react"
import { createExport, getExport } from "@/api/history"
import { download } from "@/api/files"
import { useToast } from "@/hooks/useToast"

const POLL_MS = 1000
const MAX_POLLS = 120

/**
 * Every 15-min interval of a range as CSV (History, Bills): the worker makes the file, this waits
 * for it and downloads it. Big ranges are also emailed as a link, so a long wait isn't lost.
 */
export function useCsvExport() {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  const run = async (from: string, to: string) => {
    setBusy(true)
    try {
      let e = await createExport(from, to)
      if (e.large) toast({ description: "That's a big export. It's being made now, and a link is also emailed to you when it's ready." })
      for (let i = 0; i < MAX_POLLS && e.status === "queued"; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        e = await getExport(e.id)
      }
      if (e.status === "done") await download(`/api/exports/${e.id}/file`, `energy-${e.from}-to-${e.to}.csv`)
      else if (e.status === "failed") toast({ variant: "destructive", description: `The export failed: ${e.error ?? "unknown error"}` })
      else toast({ description: "The export is still being made. It will be emailed to you when ready." })
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error ? err.message : "The export couldn't start." })
    } finally {
      setBusy(false)
    }
  }

  return { run, busy }
}
