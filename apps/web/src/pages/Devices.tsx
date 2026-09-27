import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import type { DeviceView } from "@ecomanage/shared"
import { getDevices, scanDevices } from "@/api/devices"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useMe } from "@/hooks/useMe"
import { useNow } from "@/hooks/useNow"
import { PageFrame } from "@/shell/AppShell"
import { ago } from "@/lib/format"
import { cn } from "@/lib/utils"
import { DEVICE_COLOUR, STATUS, kindOf, kwNow } from "./devices/labels"
import { DevicePanel } from "./devices/DevicePanel"
import { ScanPanel, type Scan } from "./devices/ScanPanel"

const ORDER: DeviceView["type"][] = ["pv", "battery", "meter", "submeter", "ev", "heatpump", "gateway"]

/**
 * App v2 Devices: every device with its status and power now (live from the stream), and the
 * selected one in detail. Installers scan for and commission new devices; owners and managers
 * propose changes, which go to the Inbox.
 */
export function Devices() {
  const list = useQuery({ queryKey: ["devices"], queryFn: getDevices })
  const { data: snap } = useSiteLive()
  const { role } = useMe()
  const [params, setParams] = useSearchParams()
  const [scan, setScan] = useState<Scan | null>(null)
  const now = useNow(5000)
  const tz = snap?.site.tz ?? "UTC"

  // The list has every field; the stream keeps status and readings current.
  const devices = useMemo(() => {
    const live = new Map((snap?.devices ?? []).map((d) => [d.id, d]))
    return (list.data?.items ?? [])
      .map((d) => {
        const l = live.get(d.id)
        return l ? { ...d, status: l.status, latest: l.latest ?? d.latest, lastSeenAt: l.lastSeenAt ?? d.lastSeenAt } : d
      })
      .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name))
  }, [list.data, snap])

  const selectedId = params.get("device")
  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]
  const select = (id: string) => setParams({ device: id }, { replace: true })
  const off = devices.filter((d) => d.status === "offline" || d.status === "stale").length
  const pending = devices.filter((d) => d.status === "pending").length

  const runScan = async () => {
    setScan({ state: "scanning" })
    try {
      setScan({ state: "done", found: (await scanDevices()).found })
    } catch (err) {
      setScan({ state: "error", message: err instanceof Error ? err.message : "The scan failed." })
    }
  }

  return (
    <PageFrame title="Devices">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-app-sb" data-testid="devices-summary">
          {list.data
            ? `${devices.length} devices · ${devices.length - off - pending} online · ${off} no data${pending ? ` · ${pending} not commissioned` : ""}`
            : list.isError
              ? "Devices couldn't be loaded."
              : "Loading devices…"}
        </span>
        {role === "installer" ? (
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={scan?.state === "scanning"}
            className="h-[34px] rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx disabled:opacity-70"
          >
            {scan?.state === "scanning" ? "Scanning…" : "Scan for devices"}
          </button>
        ) : null}
      </div>

      {scan ? <ScanPanel scan={scan} onCommissioned={select} /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-5">
        <div className="overflow-hidden rounded-[14px] border border-app-l2 bg-app-ps" role="table" aria-label="Devices">
          <div role="row" className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_110px_110px] border-b border-app-l2 px-[18px] py-3 text-xs text-app-dm">
            <span role="columnheader">Device</span>
            <span role="columnheader">Status</span>
            <span role="columnheader" className="text-right">
              Now
            </span>
            <span role="columnheader" className="text-right">
              Last seen
            </span>
          </div>
          {devices.map((d) => {
            const kw = kwNow(d)
            return (
              <button
                key={d.id}
                type="button"
                role="row"
                aria-selected={d.id === selected?.id}
                onClick={() => select(d.id)}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_110px_110px] items-center border-b border-app-l2 px-[18px] py-3.5 text-left text-sm text-app-tx last:border-b-0 hover:bg-app-hv",
                  d.id === selected?.id && "bg-app-hv"
                )}
              >
                <span role="cell" className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: DEVICE_COLOUR[d.type] }} aria-hidden />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="text-xs text-app-dm">{kindOf(d)}</span>
                  </span>
                </span>
                <span role="cell" className={cn("flex items-center gap-[7px] text-[13px]", STATUS[d.status].className)}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  {STATUS[d.status].text}
                </span>
                <span role="cell" className="text-right font-semibold tabular-nums" data-testid={`device-now-${d.id}`}>
                  {d.type === "gateway" ? (snap?.gateway ? `${snap.gateway.buffered} buffered` : "—") : kw == null ? "—" : `${kw.toFixed(1)} kW`}
                </span>
                <span role="cell" className="text-right text-[13px] text-app-sb">
                  {ago(d.type === "gateway" ? (snap?.gateway?.receivedAt ?? d.lastSeenAt) : (d.latest?.ts ?? d.lastSeenAt), now, tz)}
                </span>
              </button>
            )
          })}
        </div>
        {selected ? <DevicePanel key={selected.id} live={selected} role={role} tz={tz} /> : <div />}
      </div>
    </PageFrame>
  )
}
