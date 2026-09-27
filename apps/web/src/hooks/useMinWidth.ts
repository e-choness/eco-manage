import { useEffect, useState } from "react"

const query = (px: number) => (typeof window === "undefined" ? undefined : window.matchMedia?.(`(min-width: ${px}px)`))

/** True while the window is at least `px` wide (true where media queries aren't available). */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(() => query(px)?.matches ?? true)
  useEffect(() => {
    const mql = query(px)
    if (!mql) return
    const onChange = () => setWide(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [px])
  return wide
}
