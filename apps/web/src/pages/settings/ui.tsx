import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { inputClass } from "./styles"

// Settings building blocks (App v2 Settings): groups of fields, tables and toggles.

export function Group({ title, note, toggle, children }: { title: string; note?: string; toggle?: { on: boolean; set: (on: boolean) => void; disabled?: boolean }; children?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-[14px] border border-app-l2 bg-app-ps px-5 py-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-sm font-semibold">{title}</h2>
          {note ? <p className="m-0 text-[13px] text-app-sb">{note}</p> : null}
        </div>
        {toggle ? <Toggle label={`${title} on`} on={toggle.on} set={toggle.set} disabled={toggle.disabled} /> : null}
      </div>
      {children}
    </section>
  )
}

export function Toggle({ label, on, set, disabled }: { label: string; on: boolean; set: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => set(!on)}
      className={cn("relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50", on ? "bg-[#3ecf8e]" : "bg-app-tr")}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  )
}

export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3.5">{children}</div>
}

export function Field({ label, hint, suffix, children }: { label: string; hint?: string; suffix?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-[13px] text-app-sb">
        {label}
        <span className="flex items-center gap-2">
          {children}
          {suffix ? (
            <span className="whitespace-nowrap text-xs text-app-dm" aria-hidden>
              {suffix}
            </span>
          ) : null}
        </span>
      </label>
      {hint ? <span className="text-xs text-app-dm">{hint}</span> : null}
    </div>
  )
}

/** A number input whose empty value is null (or 0 when `required`). */
export function NumberInput({ value, set, disabled, step = "any", required, label }: { value: number | null; set: (v: number | null) => void; disabled?: boolean; step?: string; required?: boolean; label?: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      step={step}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => set(e.target.value === "" ? (required ? 0 : null) : Number(e.target.value))}
      className={cn(inputClass, "w-full")}
    />
  )
}

export function ReadOnly({ text }: { text: string }) {
  return (
    <p role="note" className="m-0 rounded-xl border border-app-ln bg-app-ps px-4 py-3 text-[13px] text-app-sb">
      {text}
    </p>
  )
}

export function AddRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return disabled ? null : (
    <button type="button" onClick={onClick} className="self-start p-0 text-[13px] text-tag-grid">
      + {label}
    </button>
  )
}

export function RemoveRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return disabled ? <span /> : (
    <button type="button" onClick={onClick} aria-label={label} className="p-0 text-xs text-app-sb hover:text-app-tx">
      Remove
    </button>
  )
}
