import type { CalendarInput } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import { inputClass } from "./styles"
import { AddRow, Field, Fields, Group, ReadOnly, RemoveRow } from "./ui"

type Range = CalendarInput["terms"][number]

function Ranges({ label, rows, set, canEdit, addLabel, fresh }: { label: string; rows: Range[]; set: (r: Range[]) => void; canEdit: boolean; addLabel: string; fresh: Range }) {
  const row = (i: number, patch: Partial<Range>) => set(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_60px] gap-x-3 gap-y-2" role="table" aria-label={label}>
        {["Name", "Starts", "Ends", ""].map((h, i) => (
          <span key={i} role="columnheader" className="text-xs text-app-dm">
            {h}
          </span>
        ))}
        {rows.map((r, i) => (
          <div key={i} role="row" className="contents">
            <input aria-label={`${label} ${i + 1} name`} value={r.name} disabled={!canEdit} onChange={(e) => row(i, { name: e.target.value })} className={inputClass} />
            <input type="date" aria-label={`${label} ${i + 1} start`} value={r.start} disabled={!canEdit} onChange={(e) => e.target.value && row(i, { start: e.target.value })} className={inputClass} />
            <input type="date" aria-label={`${label} ${i + 1} end`} value={r.end} disabled={!canEdit} onChange={(e) => e.target.value && row(i, { end: e.target.value })} className={inputClass} />
            <RemoveRow label={`Remove ${label.toLowerCase()} ${i + 1}`} disabled={!canEdit} onClick={() => set(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <AddRow label={addLabel} disabled={!canEdit} onClick={() => set([...rows, fresh])} />
    </>
  )
}

/** Settings → Calendar (App v2): opening hours, terms and days off; the load forecast uses them. */
export function CalendarTab({ cal, set, canEdit, today }: { cal: CalendarInput | null; set: (c: CalendarInput) => void; canEdit: boolean; today: string }) {
  if (!cal) return <ReadOnly text="Loading the calendar…" />
  return (
    <>
      {!canEdit ? <ReadOnly text="View only. Owners and managers can edit the calendar." /> : null}
      <Group title="Opening hours" note="The load forecast and peak-shaving rules use these.">
        <Fields>
          <Field label="Weekdays open">
            <input type="time" value={cal.open} disabled={!canEdit} onChange={(e) => e.target.value && set({ ...cal, open: e.target.value })} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Weekdays close">
            <input type="time" value={cal.close} disabled={!canEdit} onChange={(e) => e.target.value && set({ ...cal, close: e.target.value })} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Weekends">
            <select value={cal.weekends} disabled={!canEdit} onChange={(e) => set({ ...cal, weekends: e.target.value as CalendarInput["weekends"] })} className={cn(inputClass, "w-full")}>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
            </select>
          </Field>
        </Fields>
      </Group>
      <Group title="Terms">
        <Ranges label="Terms" rows={cal.terms} set={(terms) => set({ ...cal, terms })} canEdit={canEdit} addLabel="Add term" fresh={{ name: "New term", start: today, end: today }} />
      </Group>
      <Group title="Days off" note="The building is mostly empty on these days.">
        <Ranges label="Days off" rows={cal.daysOff} set={(daysOff) => set({ ...cal, daysOff })} canEdit={canEdit} addLabel="Add day off" fresh={{ name: "Day off", start: today, end: today }} />
      </Group>
    </>
  )
}
