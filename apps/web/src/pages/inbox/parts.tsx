import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// Building blocks of the Inbox detail (App v2): sections of rows, a timeline, buttons.

export function Section({ title, rows, text }: { title: string; rows?: [string, ReactNode, string?][]; text?: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-app-l2 pt-3.5">
      <h3 className="m-0 text-[13px] font-semibold">{title}</h3>
      {rows?.length ? (
        <dl className="m-0 grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          {rows.map(([k, v, className], i) => (
            <div key={`${k}${i}`} className="contents">
              <dt className="text-app-dm">{k}</dt>
              <dd className={cn("m-0", className)}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {text ? <p className="m-0 text-[13px] leading-normal text-app-sb">{text}</p> : null}
    </section>
  )
}

/** Steps done (green), the current one (amber) and those to come (grey). */
export function Timeline({ steps, current }: { steps: [string, string][]; current: number }) {
  return (
    <section aria-label="Timeline" className="flex flex-col gap-2 border-t border-app-l2 pt-3.5">
      <h3 className="m-0 text-[13px] font-semibold">Timeline</h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map(([label, time], i) => (
          <li key={`${label}${i}`} data-state={i < current ? "done" : i === current ? "now" : "next"} className={cn("grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]", i <= current ? "text-app-tx" : "text-app-dm")}>
            <span className={cn("h-2.5 w-2.5 rounded-full", i < current ? "bg-[#3ecf8e]" : i === current ? "bg-[#f2b33d]" : "bg-app-tr")} aria-hidden />
            <span>{label}</span>
            <span className="text-xs text-app-dm">{time}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Btn({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn("h-[34px] rounded-lg px-3.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-45", primary ? "bg-[#3ecf8e] font-semibold text-[#06140d]" : "border border-app-ln text-app-tx")}
    >
      {children}
    </button>
  )
}

export function Header({ kind, kindClass, status, statusClass, title, sub }: { kind: string; kindClass: string; status: string; statusClass: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className={cn("rounded-md px-2 py-[3px] text-[11px] font-medium", kindClass)}>{kind}</span>
        <span className={cn("text-xs", statusClass)} data-testid="detail-status">
          {status}
        </span>
      </div>
      <h2 className="m-0 text-xl font-semibold">{title}</h2>
      {sub ? <p className="m-0 text-[13px] leading-normal text-app-sb">{sub}</p> : null}
    </div>
  )
}

export function Payload({ title, value }: { title: string; value: unknown }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5 border-t border-app-l2 pt-3.5">
      <h3 className="m-0 text-[13px] font-semibold">{title}</h3>
      <pre className="m-0 whitespace-pre-wrap break-all rounded-lg bg-app-bg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-app-sb">{JSON.stringify(value)}</pre>
    </section>
  )
}
