import type { NotificationPrefs, Role } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import { inputClass } from "./styles"
import { Field, Fields, Group, NumberInput, ReadOnly, Toggle } from "./ui"

/** Settings → Notifications (App v2): your own emails, for this site. */
export function NotificationsTab({ prefs, set, role }: { prefs: NotificationPrefs | null; set: (p: NotificationPrefs) => void; role: Role | null }) {
  if (!prefs) return <ReadOnly text="Loading your notifications…" />
  const toggle = (k: "alerts" | "daily" | "recs" | "failures", label: string, hint?: string, locked?: boolean) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-[13px] text-app-sb">
        {label}
        <Toggle label={label} on={locked ? true : prefs[k]} disabled={locked} set={(on) => set({ ...prefs, [k]: on })} />
      </div>
      {hint ? <span className="text-xs text-app-dm">{hint}</span> : null}
    </div>
  )
  const money = role === "owner" || role === "manager"
  return (
    <Group title="Your notifications" note="These apply to you only.">
      <Fields>
        <Field label="Send to">
          <input type="email" value={prefs.email} onChange={(e) => set({ ...prefs, email: e.target.value })} className={cn(inputClass, "w-full")} />
        </Field>
        {toggle("alerts", "Alerts by email")}
        {toggle("daily", "Daily summary at 07:00")}
        {money ? toggle("recs", "New proposals") : null}
        {toggle("failures", "Command failures", money ? "Always sent to owners and managers." : undefined, money)}
        <Field label="Quiet hours from" hint="Warnings wait until quiet hours end. Failures always send.">
          <input type="time" value={prefs.quietFrom ?? ""} onChange={(e) => set({ ...prefs, quietFrom: e.target.value || null, quietTo: e.target.value ? (prefs.quietTo ?? "06:30") : null })} className={cn(inputClass, "w-full")} />
        </Field>
        <Field label="Quiet hours to">
          <input type="time" value={prefs.quietTo ?? ""} onChange={(e) => set({ ...prefs, quietTo: e.target.value || null, quietFrom: e.target.value ? (prefs.quietFrom ?? "22:00") : null })} className={cn(inputClass, "w-full")} />
        </Field>
        {role === "owner" ? (
          <Field label="Email me if an alert isn't acknowledged within" suffix="min">
            <NumberInput value={prefs.escalateMin} required step="1" set={(v) => set({ ...prefs, escalateMin: v ?? 30 })} />
          </Field>
        ) : null}
      </Fields>
    </Group>
  )
}
