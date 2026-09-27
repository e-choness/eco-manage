import type { ReactNode } from "react"
import { Navigate, Outlet } from "react-router-dom"
import type { Role } from "@ecomanage/shared"
import { useAuth } from "@/contexts/AuthContext"
import { useMe } from "@/hooks/useMe"
import { Button } from "@/components/ui/button"
import { Rail } from "./Rail"
import { SiteStreamProvider } from "./SiteStreamProvider"

/** Signed-in layout: the rail on the left, the page beside it, one live stream for both. */
export function AppShell() {
  const { membership, isLoading, isError } = useMe()
  if (isLoading) return <div className="min-h-screen bg-app-bg" aria-busy="true" />
  if (!membership) return <NoSite failed={isError} />
  return (
    <SiteStreamProvider>
      <div className="min-h-screen bg-app-bg text-app-tx">
        <a href="#content" className="sr-only z-50 rounded-lg bg-app-ps px-3 py-2 text-sm text-app-tx focus:not-sr-only focus:fixed focus:left-20 focus:top-3">
          Skip to content
        </a>
        <Rail />
        <div id="content" tabIndex={-1} className="pl-[68px] outline-hidden">
          <Outlet />
        </div>
      </div>
    </SiteStreamProvider>
  )
}

/** Inner pages (App v2): site name over the page title, who is signed in on the right. */
export function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth()
  const { membership, roleLabel } = useMe()
  return (
    <main className="min-h-screen bg-app-bg">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 pb-[60px] pt-7 xl:px-10">
        <header className="flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-app-sb">{membership?.siteName}</span>
            <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{title}</h1>
          </div>
          <div className="text-[13px] text-app-sb">
            {user?.name || user?.email} · {roleLabel}
          </div>
        </header>
        {children}
      </div>
    </main>
  )
}

/** A page some roles don't get (Bills for installers) sends them Home; the API refuses them too. */
export function RequireRole({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const { role } = useMe()
  if (!role || !roles.includes(role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function NoSite({ failed }: { failed: boolean }) {
  const { logout } = useAuth()
  return (
    <main className="flex min-h-screen items-center justify-center bg-app-bg p-6 text-app-tx">
      <div className="flex max-w-md flex-col gap-4 rounded-xl border border-app-ln bg-app-ps p-8">
        <h1 className="m-0 text-xl font-semibold">{failed ? "Couldn't load your account" : "No site yet"}</h1>
        <p className="m-0 text-sm text-app-sb">
          {failed
            ? "Check your connection and reload the page."
            : "Your account doesn't have access to a site. Ask the site owner to invite you, then sign in again."}
        </p>
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </main>
  )
}
