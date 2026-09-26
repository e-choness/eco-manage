import { useEffect } from "react"
import { useTheme } from "@/components/ui/theme-provider"
import { useAuth } from "@/contexts/AuthContext"
import { updateProfile } from "@/api/auth"

/**
 * Light / dark, saved on the user (PUT /api/auth/profile) so it follows them to other browsers.
 * A saved choice wins over this browser's; with none saved, the browser's choice stays.
 */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { user, updateUser } = useAuth()
  const saved = user?.theme ?? null

  useEffect(() => {
    if (saved) setTheme(saved)
  }, [saved, setTheme])

  const toggle = () => {
    const next = resolvedTheme === "dark" ? "light" : "dark"
    setTheme(next)
    updateUser({ theme: next })
    updateProfile({ theme: next }).catch(() => {
      // kept in this browser; saved on the user next time
    })
  }

  return { theme: resolvedTheme, toggle }
}
