import { useEffect, useState } from "react"

/** The time now, refreshed every `ms`, so clocks and "2 s ago" stay current. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
