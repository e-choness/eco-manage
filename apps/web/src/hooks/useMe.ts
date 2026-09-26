import { useQuery } from "@tanstack/react-query"
import type { MeResponse, Role } from "@ecomanage/shared"
import { getMe } from "@/api/me"

export const ME_KEY = ["me"] as const

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", installer: "Installer" }

/**
 * The signed-in user and the site they are looking at. Like the API (middleware/roles.ts), the
 * site is the first active membership; the role comes from it. There is no role switcher.
 */
export function useMe() {
  const query = useQuery({ queryKey: ME_KEY, queryFn: getMe, staleTime: 5 * 60_000 })
  const membership: MeResponse["memberships"][number] | null = query.data?.memberships[0] ?? null
  return {
    ...query,
    me: query.data ?? null,
    membership,
    role: membership?.role ?? null,
    roleLabel: membership ? ROLE_LABEL[membership.role] : "",
  }
}

/** "Priya Shah" → "PS"; falls back to the email. */
export const initialsOf = (name: string | undefined, email: string): string => {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}
