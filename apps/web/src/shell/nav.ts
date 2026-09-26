import { ChartLine, House, Inbox, PlugZap, Receipt, Settings, type LucideIcon } from "lucide-react"
import type { Role } from "@ecomanage/shared"

export interface NavItem {
  id: "home" | "devices" | "history" | "bills" | "inbox" | "settings"
  label: string
  path: string
  icon: LucideIcon
  roles?: readonly Role[] // who sees it; everyone when absent
}

// The rail (App v2): installers don't see Bills (no money views), and the API refuses them too.
export const NAV: readonly NavItem[] = [
  { id: "home", label: "Home", path: "/dashboard", icon: House },
  { id: "devices", label: "Devices", path: "/dashboard/devices", icon: PlugZap },
  { id: "history", label: "History", path: "/dashboard/history", icon: ChartLine },
  { id: "bills", label: "Bills", path: "/dashboard/bills", icon: Receipt, roles: ["owner", "manager"] },
  { id: "inbox", label: "Inbox", path: "/dashboard/inbox", icon: Inbox },
  { id: "settings", label: "Settings", path: "/dashboard/settings", icon: Settings },
]

export const navFor = (role: Role | null): NavItem[] => NAV.filter((n) => !n.roles || (role !== null && n.roles.includes(role)))

export const canSee = (id: NavItem["id"], role: Role | null): boolean => navFor(role).some((n) => n.id === id)
