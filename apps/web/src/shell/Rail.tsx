import { NavLink } from "react-router-dom"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMe } from "@/hooks/useMe"
import { useInboxCounts } from "@/hooks/useSiteStream"
import { navFor } from "./nav"
import { useThemeToggle } from "./useThemeToggle"
import { AvatarMenu } from "./AvatarMenu"

const ICON_BUTTON = "relative flex h-[42px] w-[42px] items-center justify-center rounded-[11px] outline-hidden focus-visible:ring-2 focus-visible:ring-ring"

// The 68 px icon rail (App v2). The Inbox badge counts what needs someone: decisions waiting
// and open alerts. It is kept current by the stream's `inbox` events.
export function Rail() {
  const { role } = useMe()
  const { data: counts } = useInboxCounts()
  const { theme, toggle } = useThemeToggle()
  const needsYou = counts ? counts.open.decide + counts.open.alert : 0

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[68px] flex-col items-center gap-1.5 border-r border-app-l2 bg-app-rl py-[18px] backdrop-blur-[10px]">
      <img src="/favicon.svg" alt="EcoManage" className="mb-[18px] h-[26px] w-[26px]" />
      <nav aria-label="Main" className="flex flex-col items-center gap-1.5">
        {navFor(role).map((n) => {
          const badge = n.id === "inbox" && needsYou > 0 ? (needsYou > 99 ? "99+" : String(needsYou)) : null
          return (
            <NavLink
              key={n.id}
              to={n.path}
              end={n.id === "home"}
              title={n.label}
              aria-label={badge ? `${n.label}, ${needsYou} need you` : n.label}
              className={({ isActive }) => cn(ICON_BUTTON, isActive ? "bg-app-ch text-app-tx" : "text-app-sb hover:bg-app-hv hover:text-app-tx")}
            >
              <n.icon className="h-[19px] w-[19px]" aria-hidden />
              {badge ? (
                <span
                  data-testid="inbox-badge"
                  aria-hidden
                  className="absolute right-[3px] top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-lg bg-badge px-[3px] text-[9px] font-bold text-badge-foreground"
                >
                  {badge}
                </span>
              ) : null}
            </NavLink>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          title="Switch light / dark"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className={cn(ICON_BUTTON, "text-app-sb hover:bg-app-hv hover:text-app-tx")}
        >
          {theme === "dark" ? <Sun className="h-[19px] w-[19px]" aria-hidden /> : <Moon className="h-[19px] w-[19px]" aria-hidden />}
        </button>
        <AvatarMenu />
      </div>
    </aside>
  )
}
