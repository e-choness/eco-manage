import { CURRENCIES, type GatewayView, type PvArraysInput } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import { TIME_ZONES, type Drafts } from "./model"
import { inputClass } from "./styles"
import { AddRow, CellRow, Field, Fields, Group, HeaderRow, NumberInput, ReadOnly, RemoveRow } from "./ui"

interface Props {
  site: Drafts["site"]
  setSite: (v: Drafts["site"]) => void
  arrays: PvArraysInput
  setArrays: (v: PvArraysInput) => void
  battery: Drafts["battery"] | null
  setBattery: (v: Drafts["battery"]) => void
  canSite: boolean
  canHardware: boolean
  inverters: { id: string; name: string }[]
  gateway: GatewayView | undefined
}

/** Settings → Site (App v2): details (owner), solar arrays and battery (owner, installer), gateway. */
export function SiteTab({ site, setSite, arrays, setArrays, battery, setBattery, canSite, canHardware, inverters, gateway }: Props) {
  const s = <K extends keyof Drafts["site"]>(k: K, v: Drafts["site"][K]) => setSite({ ...site, [k]: v })
  const row = (i: number, patch: Partial<PvArraysInput[number]>) => setArrays(arrays.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const zones = TIME_ZONES.includes(site.tz) ? TIME_ZONES : [site.tz, ...TIME_ZONES]
  return (
    <>
      {!canSite ? <ReadOnly text={canHardware ? "You can edit solar arrays and battery details. Site details are owner-only." : "View only. The owner edits site details. The owner or installer edits hardware."} /> : null}
      <Group title="Site">
        <Fields>
          <Field label="Name">
            <input value={site.name} disabled={!canSite} onChange={(e) => s("name", e.target.value)} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Address">
            <input value={site.address} disabled={!canSite} onChange={(e) => s("address", e.target.value)} className={cn(inputClass, "w-full")} />
          </Field>
          <Field label="Time zone" hint="Tariff periods and reports use this time zone.">
            <select value={site.tz} disabled={!canSite} onChange={(e) => s("tz", e.target.value)} className={cn(inputClass, "w-full")}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Field>
          <Field label="Latitude">
            <NumberInput value={site.lat} disabled={!canSite} set={(v) => s("lat", v)} />
          </Field>
          <Field label="Longitude">
            <NumberInput value={site.lon} disabled={!canSite} set={(v) => s("lon", v)} />
          </Field>
          <Field label="Currency">
            <select value={site.currency} disabled={!canSite} onChange={(e) => s("currency", e.target.value as Drafts["site"]["currency"])} className={cn(inputClass, "w-full")}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Billing day" hint="The day of the month each billing period starts.">
            <NumberInput value={site.billDay} required disabled={!canSite} set={(v) => s("billDay", v ?? 1)} step="1" />
          </Field>
          <Field label="Demand cap" suffix="kW" hint="Peak shaving and alerts work to keep demand under it.">
            <NumberInput value={site.demandCapKw} disabled={!canSite} set={(v) => s("demandCapKw", v)} />
          </Field>
        </Fields>
      </Group>

      <Group title="Solar arrays" note="Used to calculate expected output per inverter.">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_110px_90px_100px_60px] gap-x-3 gap-y-2 text-[13px]" role="table" aria-label="Solar arrays">
          <HeaderRow labels={["Name", "Inverter", "Size (kWp)", "Tilt (°)", "Azimuth (°)", ""]} />
          {arrays.map((a, i) => (
            <CellRow key={a.id ?? `new${i}`}>
              <input aria-label={`Array ${i + 1} name`} value={a.name} disabled={!canHardware} onChange={(e) => row(i, { name: e.target.value })} className={inputClass} />
              <select aria-label={`Array ${i + 1} inverter`} value={a.inverterId} disabled={!canHardware} onChange={(e) => row(i, { inverterId: e.target.value })} className={inputClass}>
                {inverters.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
              <NumberInput label={`Array ${i + 1} size`} value={a.kwp} required disabled={!canHardware} set={(v) => row(i, { kwp: v ?? 0 })} />
              <NumberInput label={`Array ${i + 1} tilt`} value={a.tiltDeg} required disabled={!canHardware} set={(v) => row(i, { tiltDeg: v ?? 0 })} />
              <NumberInput label={`Array ${i + 1} azimuth`} value={a.azimuthDeg} required disabled={!canHardware} set={(v) => row(i, { azimuthDeg: v ?? 0 })} />
              <RemoveRow label={`Remove array ${i + 1}`} disabled={!canHardware} onClick={() => setArrays(arrays.filter((_, j) => j !== i))} />
            </CellRow>
          ))}
        </div>
        <AddRow label="Add array" disabled={!canHardware || !inverters.length} onClick={() => setArrays([...arrays, { name: `Array ${arrays.length + 1}`, inverterId: inverters[0].id, kwp: 10, tiltDeg: 10, azimuthDeg: 180 }])} />
      </Group>

      {battery ? (
        <Group title="Battery">
          <Fields>
            <Field label="Usable capacity" suffix="kWh">
              <NumberInput value={battery.usableKwh} required disabled={!canHardware} set={(v) => setBattery({ ...battery, usableKwh: v ?? 0 })} />
            </Field>
            <Field label="Max charge / discharge" suffix="kW">
              <NumberInput value={battery.maxKw} required disabled={!canHardware} set={(v) => setBattery({ ...battery, maxKw: v ?? 0 })} />
            </Field>
            <Field label="Hardware minimum reserve" suffix="%" hint="No command can go below this. The gateway enforces it.">
              <NumberInput value={battery.floorPct} required disabled={!canHardware} set={(v) => setBattery({ ...battery, floorPct: v ?? 0 })} />
            </Field>
          </Fields>
        </Group>
      ) : null}

      <Group title="Gateway" note="Reported by the gateway. Not editable.">
        <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 text-[13px]">
          {[
            ["ID", gateway?.id ?? "—"],
            ["Status", gateway ? (gateway.online ? "Online" : "Offline") : "—"],
            ["Firmware", gateway?.fw ?? "—"],
            ["Offline buffer", gateway ? `${gateway.buffered ?? 0} readings held · keeps ${gateway.bufferDays} days` : "—"],
            ["Reserve it enforces", gateway?.batteryFloorPct != null ? `${gateway.batteryFloorPct}%${gateway.configPending ? " (update pending)" : ""}` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1">
              <dt className="text-app-sb">{k}</dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
        </dl>
      </Group>
    </>
  )
}
