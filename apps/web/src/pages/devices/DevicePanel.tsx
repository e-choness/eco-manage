import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { CommissionResult, DeviceView, Role } from "@ecomanage/shared"
import { commissionDevice, getDevice, getDeviceTelemetry, logVisit } from "@/api/devices"
import { useToast } from "@/hooks/useToast"
import { longDay } from "@/lib/format"
import { DEVICE_COLOUR, STATUS, kindOf, kwNow, proposable, qualityOf } from "./labels"
import { ProposeChange } from "./ProposeChange"

const section = "flex flex-col gap-2.5 border-t border-app-l2 pt-3.5"

/** The selected device (App v2 Devices, right): live value, last 24 h, details, control, log. */
export function DevicePanel({ live, role, tz }: { live: DeviceView; role: Role | null; tz: string }) {
  const detail = useQuery({ queryKey: ["device", live.id], queryFn: () => getDevice(live.id) })
  const series = useQuery({ queryKey: ["device", live.id, "telemetry"], queryFn: () => getDeviceTelemetry(live.id), refetchInterval: 5 * 60_000 })
  const d = detail.data ? { ...detail.data, status: live.status, latest: live.latest ?? detail.data.latest, lastSeenAt: live.lastSeenAt } : null
  const status = STATUS[live.status]
  const kw = kwNow(live)

  return (
    <aside aria-label={live.name} className="sticky top-0 flex flex-col gap-[18px] rounded-[14px] border border-app-l2 bg-app-ps p-[22px]">
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${status.className}`}>{status.text}</span>
        <h2 className="m-0 text-xl font-semibold">{live.name}</h2>
        <span className="text-[13px] text-app-sb">{kindOf(live)}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[40px] font-semibold leading-none tabular-nums" data-testid="device-kw">
          {live.type === "gateway" ? "—" : kw == null ? "—" : kw.toFixed(1)}
        </span>
        <span className="text-sm text-app-sb">{live.type === "gateway" ? "" : "kW"}</span>
      </div>

      <Spark points={series.data?.points ?? []} colour={DEVICE_COLOUR[live.type]} loading={series.isLoading} />

      {d ? (
        <>
          <dl className={`${section} m-0 grid grid-cols-[110px_1fr] gap-y-2 text-[13px]`}>
            <dt className="text-app-dm">Model</dt>
            <dd className="m-0">{d.profile ? `${d.profile.vendor} ${d.profile.model}` : "—"}</dd>
            <dt className="text-app-dm">Protocol</dt>
            <dd className="m-0">{d.profile?.protocol ?? "—"}</dd>
            <dt className="text-app-dm">Address</dt>
            <dd className="m-0 font-mono text-xs">{d.address || "—"}</dd>
            <dt className="text-app-dm">Profile</dt>
            <dd className="m-0 font-mono text-xs">{d.profileId ?? "none"}</dd>
            <dt className="text-app-dm">Data</dt>
            <dd className={`m-0 ${qualityOf(d, tz).className}`}>{qualityOf(d, tz).text}</dd>
            <dt className="text-app-dm">Commissioned</dt>
            <dd className="m-0">{d.commissionedAt ? `${longDay(d.commissionedAt, tz)}${d.commissionedBy ? ` · ${d.commissionedBy.name}` : ""}` : "Not yet"}</dd>
          </dl>

          {d.status === "pending" && !d.commissionedAt && role === "installer" ? <Commission deviceId={d.id} /> : null}

          <div className={section}>
            <h3 className="m-0 text-[13px] font-semibold">Control</h3>
            {!proposable(d).length ? (
              <p className="m-0 text-[13px] text-app-sb">Read only.</p>
            ) : d.status === "offline" ? (
              <p className="m-0 text-[13px] text-app-sb">Unavailable while offline.</p>
            ) : role === "owner" || role === "manager" ? (
              <>
                <p className="m-0 text-[13px] text-app-sb">Changes go to the Inbox for approval, with the same checks as the rules.</p>
                <ProposeChange key={d.id} device={d} />
              </>
            ) : (
              <p className="m-0 text-[13px] text-app-sb">Installers can view controls. A manager or owner makes changes.</p>
            )}
          </div>

          <Maintenance deviceId={d.id} entries={d.maintenance} canLog={role === "installer"} tz={tz} />

          <div className={section}>
            <h3 className="m-0 text-[13px] font-semibold">Last message</h3>
            <pre className="m-0 whitespace-pre-wrap break-all rounded-lg bg-app-bg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-app-sb" data-testid="device-raw">
              {d.latest ? JSON.stringify(d.latest) : "Nothing received yet."}
            </pre>
          </div>
        </>
      ) : detail.isError ? (
        <p className="m-0 text-[13px] text-app-sb">This device couldn't be loaded.</p>
      ) : (
        <div className="h-40" aria-busy="true" />
      )}
    </aside>
  )
}

function Spark({ points, colour, loading }: { points: { ts: string; p_kw: number; estimated: boolean }[]; colour: string; loading: boolean }) {
  const max = Math.max(0.1, ...points.map((p) => Math.abs(p.p_kw)))
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-app-dm">Last 24 h</span>
      {points.length ? (
        <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`Hourly power, highest ${max.toFixed(1)} kW`}>
          {points.map((p) => (
            <span
              key={p.ts}
              data-testid="spark-bar"
              title={p.estimated ? "includes estimated readings" : undefined}
              className="flex-1 rounded-t-sm"
              style={{ height: `${Math.max(2, (Math.abs(p.p_kw) / max) * 100)}%`, background: colour, opacity: p.estimated ? 0.4 : 0.85 }}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 h-16 text-[13px] text-app-sb">{loading ? "" : "No readings in the last 24 hours."}</p>
      )}
    </div>
  )
}

function Commission({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CommissionResult | null>(null)
  const [error, setError] = useState("")
  const run = async () => {
    setRunning(true)
    setError("")
    try {
      const r = await commissionDevice(deviceId)
      setResult(r)
      if (r.ok) toast({ description: `${r.device.name} is commissioned.` })
      void queryClient.invalidateQueries({ queryKey: ["device", deviceId] })
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commissioning failed.")
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className={section}>
      <h3 className="m-0 text-[13px] font-semibold">Commissioning</h3>
      {result?.checks.map((c) => (
        <span key={c.name} className={`text-[13px] ${c.pass ? "text-tag-bat" : "text-tag-hp"}`}>
          {c.name} · {c.pass ? "passed" : "failed"}
        </span>
      ))}
      {error || (result && !result.ok) ? (
        <p role="alert" className="m-0 text-xs text-tag-hp">
          {error || result?.error}
        </p>
      ) : null}
      {result?.ok ? null : (
        <button type="button" onClick={() => void run()} disabled={running} className="h-[34px] self-start rounded-lg bg-[#3ecf8e] px-3.5 text-[13px] font-semibold text-[#06140d] disabled:opacity-70">
          {running ? "Checking…" : "Commission"}
        </button>
      )}
    </div>
  )
}

function Maintenance({ deviceId, entries, canLog, tz }: { deviceId: string; entries: { at: string; source: "visit" | "alert"; text: string }[]; canLog: boolean; tz: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (text.trim().length < 3) return setError("Say what was done.")
    try {
      await logVisit(deviceId, text.trim())
      toast({ description: "Visit note added to the device log." })
      setText("")
      setOpen(false)
      setError("")
      void queryClient.invalidateQueries({ queryKey: ["device", deviceId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "The note couldn't be saved.")
    }
  }
  return (
    <div className={section}>
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-semibold">Maintenance</h3>
        {canLog && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="p-0 text-[13px] text-tag-grid">
            Log a visit
          </button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={save} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-app-sb">
            What was done
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} autoFocus className="rounded-lg border border-app-ln bg-app-bg px-2.5 py-2 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </label>
          {error ? (
            <p role="alert" className="m-0 text-xs text-tag-hp">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="h-[34px] rounded-lg border border-app-ln px-3 text-[13px] font-medium text-app-tx">
              Save
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-[34px] px-2 text-[13px] text-app-sb">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {entries.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {entries.slice(0, 5).map((m) => (
            <li key={`${m.at}${m.text}`} className="text-[13px] text-app-sb">
              <span className="text-app-dm">{longDay(m.at, tz)} · </span>
              {m.source === "alert" ? "Alert: " : ""}
              {m.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-app-sb">No visits logged.</p>
      )}
    </div>
  )
}
