import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  // What is on screen: "system" resolved through prefers-color-scheme
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

const systemTheme = (): "dark" | "light" =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"

const readStored = (key: string): Theme | null => {
  try {
    const v = localStorage.getItem(key)
    return v === "dark" || v === "light" || v === "system" ? v : null
  } catch {
    return null
  }
}

// The class on <html> (dark or light) switches the colour tokens in index.css. The choice is kept
// in localStorage for the next visit; the shell also saves it on the user (P4-01).
export function ThemeProvider({ children, defaultTheme = "system", storageKey = "vite-ui-theme" }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStored(storageKey) ?? defaultTheme)
  const resolvedTheme = theme === "system" ? systemTheme() : theme

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback(
    (next: Theme) => {
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // private mode: the choice lasts for this visit
      }
      setThemeState(next)
    },
    [storageKey]
  )

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider")
  return context
}
