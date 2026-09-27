import type { ReactNode } from "react"

/**
 * Login and invite screens (App v2 Login): a 520 px panel with the brand on top, the form in the
 * middle and a note at the bottom; the site's picture fills the rest.
 */
export function AuthLayout({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-app-gr text-app-tx lg:grid-cols-[520px_1fr]">
      <div className="z-1 flex flex-col justify-between gap-10 border-r border-app-l2 bg-app-ps px-6 py-10 sm:px-14">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold">EcoManage</span>
        </div>
        <main className="flex flex-col gap-7">{children}</main>
        <div className="text-xs text-app-dm">{footer}</div>
      </div>
      <div aria-hidden className="hidden lg:block" />
    </div>
  )
}

/** A labelled input; a hint goes under it, outside the label, and is linked by `hintId`. */
export function Field({ label, children, hint, hintId }: { label: string; children: ReactNode; hint?: ReactNode; hintId?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
        {label}
        {children}
      </label>
      {hint ? (
        <span id={hintId} className="text-xs text-app-dm">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
