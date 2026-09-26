import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { LogOut, UserRound } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/contexts/AuthContext"
import { initialsOf, useMe } from "@/hooks/useMe"
import { ProfileDialog } from "./ProfileDialog"

// Bottom of the rail: initials, opening Profile and Sign out. The role shown comes from the
// membership; there is no role switcher.
export function AvatarMenu() {
  const { user, logout } = useAuth()
  const { membership, roleLabel } = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  if (!user) return null
  const who = user.name || user.email

  const signOut = async () => {
    try {
      await logout()
    } finally {
      queryClient.clear()
      navigate("/login", { replace: true })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Account: ${who}${roleLabel ? `, ${roleLabel}` : ""}`}
          title={`${who}${roleLabel ? ` · ${roleLabel}` : ""}`}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-app-ch text-xs font-semibold text-tag-grid outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initialsOf(user.name, user.email)}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={12} className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="font-medium">{who}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
            {membership ? (
              <span className="text-xs text-muted-foreground">
                {roleLabel} · {membership.siteName}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserRound className="mr-2 h-4 w-4" aria-hidden />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  )
}
