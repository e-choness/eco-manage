import { useQuery } from "@tanstack/react-query"
import { DAY_SETS, dayPrices, validateTariff, type TariffInput, type TariffIssue } from "@ecomanage/shared"
import { getTariffTemplates } from "@/api/settings"
import { cn } from "@/lib/utils"
import { inputClass } from "./styles"
import { AddRow, CellRow, Field, Fields, Group, HeaderRow, NumberInput, ReadOnly, RemoveRow } from "./ui"

const LEVEL = { off: "bg-price-off text-tag-grid", mid: "bg-price-mid text-app-sb", peak: "bg-price-peak text-tag-hp" } as const
const dollars = (cents: number) => Math.round(cents * 10) / 1000 // cents → $ with 3 decimals kept for fractions
const cents = (d: number | null) => Math.round((d ?? 0) * 100 * 1000) / 1000

/** A weekday (Wednesday) or weekend (Saturday) date in a month, for previewing a day's prices. */
const sampleDate = (month: number, weekend: boolean): string => {
  const year = new Date().getUTCFullYear()
  for (let d = 1; d <= 7; d++) {
    const at = new Date(Date.UTC(year, month - 1, d))
    if (at.getUTCDay() === (weekend ? 6 : 3)) return at.toISOString().slice(0, 10)
  }
  return `${year}-${String(month).padStart(2, "0")}-01`
}

/** The strips to preview: each season (or all year) on weekdays and on weekends. */
const strips = (t: TariffInput) => {
  const seasons = t.seasons.length ? t.seasons.map((s) => ({ label: s.name, month: s.fromMonth })) : [{ label: "All year", month: 1 }]
  return seasons.flatMap((s) =>
    [false, true].map((weekend) => {
      const label = `${weekend ? "Weekends" : "Weekdays"} · ${s.label}`
      try {
        return { label, segs: dayPrices(t, sampleDate(s.month, weekend), "UTC"), error: null }
      } catch {
        return { label, segs: [], error: "Part of the day has no rate" }
      }
    })
  )
}

interface Props {
  tariff: TariffInput | null
  setTariff: (t: TariffInput) => void
  version: number | null
  canEdit: boolean
  canView: boolean
  serverIssues: TariffIssue[]
}

/** Settings → Tariff (App v2): a new version from its valid-from date, previewed as you edit. */
export function TariffTab({ tariff, setTariff, version, canEdit, canView, serverIssues }: Props) {
  const templates = useQuery({ queryKey: ["tariff-templates"], queryFn: getTariffTemplates, enabled: canEdit, staleTime: Infinity })
  if (!canView) return <ReadOnly text="The tariff is shown to owners and managers." />
  if (!tariff) return <ReadOnly text="Loading the tariff…" />
  const t = tariff
  const set = <K extends keyof TariffInput>(k: K, v: TariffInput[K]) => setTariff({ ...t, [k]: v })
  const period = (i: number, patch: Partial<TariffInput["periods"][number]>) => set("periods", t.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const issues = [...validateTariff(t), ...serverIssues.filter((i) => i.kind === "valid-from")]
  const seasonOptions = [{ id: "all", name: "All year" }, ...t.seasons]

  return (
    <>
      {!canEdit ? <ReadOnly text="View only. Only the owner can change the tariff." /> : null}
      <section aria-label="Price by time of day" className="flex flex-col gap-3 rounded-[14px] border border-app-l2 bg-app-ps px-5 py-[18px]">
        <div className="flex justify-between text-[13px]">
          <span className="font-semibold">Price by time of day</span>
          <span className="text-app-dm">Updates as you edit the periods below</span>
        </div>
        {strips(t).map((s) => (
          <div key={s.label} className="grid grid-cols-[170px_minmax(0,1fr)] items-center gap-3 text-xs">
            <span className="text-app-sb">{s.label}</span>
            {s.error ? (
              <span className="text-tag-hp" data-testid="strip-warning">
                {s.error}
              </span>
            ) : (
              <div className="flex h-6 gap-[2px] overflow-hidden rounded-md font-mono text-[11px]" data-testid="tariff-strip">
                {s.segs.map((g) => {
                  const w = (Date.parse(g.end) - Date.parse(g.start)) / 864_000
                  return (
                    <div key={g.start} className={cn("flex items-center overflow-hidden whitespace-nowrap pl-2", LEVEL[g.level])} style={{ flex: `${w} 1 0%` }}>
                      {w >= 8 ? `${g.name.toLowerCase()} $${(g.rateCents / 100).toFixed(2)}` : ""}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-3 font-mono text-[11px] text-app-dm" aria-hidden>
          <span />
          <span className="flex justify-between">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </span>
        </div>
        {issues.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Tariff problems">
            {issues.map((i, n) => (
              <li key={n} role="alert" className="text-[13px] text-tag-hp">
                {i.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Group title="Tariff" note="Saving creates a new version from the valid-from date. Earlier bills keep the version they were billed on.">
        <Fields>
          <Field label="Name">
            <input value={t.name} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Valid from">
            <input type="date" value={t.validFrom} disabled={!canEdit} onChange={(e) => e.target.value && set("validFrom", e.target.value)} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Current version">
            <input value={version != null ? `Version ${version}` : "None yet"} disabled className={cn(inputClass, "w-full")} />
          </Field>
          {canEdit ? (
            <Field label="Load periods from a template">
              <select
                value=""
                onChange={(e) => {
                  const tpl = templates.data?.find((x) => x.id === e.target.value)
                  if (tpl) setTariff({ ...tpl.tariff, validFrom: t.validFrom })
                }}
                className={cn(inputClass, "w-full")}
              >
                <option value="">Keep current periods</option>
                {templates.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </Fields>
      </Group>

      <Group title="Time-of-use periods" note="An end time of 00:00 means midnight.">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_110px_110px_130px_60px] gap-x-3 gap-y-2" role="table" aria-label="Periods">
          <HeaderRow labels={["Period", "Season", "Days", "Start", "End", "Rate ($/kWh)", ""]} />
          {t.periods.map((p, i) => (
            <CellRow key={i}>
              <input aria-label={`Period ${i + 1} name`} value={p.name} disabled={!canEdit} onChange={(e) => period(i, { name: e.target.value })} className={inputClass} />
              <select aria-label={`Period ${i + 1} season`} value={p.season} disabled={!canEdit} onChange={(e) => period(i, { season: e.target.value })} className={inputClass}>
                {seasonOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select aria-label={`Period ${i + 1} days`} value={p.days} disabled={!canEdit} onChange={(e) => period(i, { days: e.target.value as (typeof DAY_SETS)[number] })} className={inputClass}>
                {DAY_SETS.map((d) => (
                  <option key={d} value={d}>
                    {d === "all" ? "Every day" : d === "weekdays" ? "Weekdays" : "Weekends"}
                  </option>
                ))}
              </select>
              <input type="time" aria-label={`Period ${i + 1} start`} value={p.start} disabled={!canEdit} onChange={(e) => e.target.value && period(i, { start: e.target.value })} className={inputClass} />
              <input type="time" aria-label={`Period ${i + 1} end`} value={p.end} disabled={!canEdit} onChange={(e) => e.target.value && period(i, { end: e.target.value })} className={inputClass} />
              <NumberInput label={`Period ${i + 1} rate`} value={dollars(p.rateCents)} required step="0.01" disabled={!canEdit} set={(v) => period(i, { rateCents: cents(v) })} />
              <RemoveRow label={`Remove period ${i + 1}`} disabled={!canEdit} onClick={() => set("periods", t.periods.filter((_, j) => j !== i))} />
            </CellRow>
          ))}
        </div>
        <AddRow label="Add period" disabled={!canEdit} onClick={() => set("periods", [...t.periods, { name: "Mid", season: "all", days: "weekdays", start: "00:00", end: "00:00", rateCents: 10 }])} />
      </Group>

      <Group title="Demand and other charges">
        <Fields>
          <Field label="Demand rate" suffix="$/kW/month">
            <NumberInput value={dollars(t.demandRateCents)} required step="0.01" disabled={!canEdit} set={(v) => set("demandRateCents", cents(v))} />
          </Field>
          <Field label="Demand measured over">
            <select value={t.demandIntervalMin} disabled={!canEdit} onChange={(e) => set("demandIntervalMin", Number(e.target.value) as 15 | 30)} className={cn(inputClass, "w-full")}>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
            </select>
          </Field>
          <Field label="Export rate" suffix="$/kWh">
            <NumberInput value={dollars(t.exportRateCents)} required step="0.01" disabled={!canEdit} set={(v) => set("exportRateCents", cents(v))} />
          </Field>
          <Field label="Fixed fees" suffix="$/month">
            <NumberInput value={dollars(t.fixedCents)} required step="0.01" disabled={!canEdit} set={(v) => set("fixedCents", Math.round((v ?? 0) * 100))} />
          </Field>
        </Fields>
      </Group>
    </>
  )
}
