import { useMemo, useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { DeviceDetail, ProfileActionView } from "@ecomanage/shared"
import { proposable } from "./labels"
import { proposeChange } from "@/api/devices"
import { useToast } from "@/hooks/useToast"

const MIN = 60_000
const input = "h-9 rounded-lg border border-app-ln bg-app-bg px-2.5 text-[13px] text-app-tx outline-none focus-visible:ring-2 focus-visible:ring-ring"

const label = (id: string) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

// Parameter names as people say them; the action can say it better (a reserve's "pct").
const PARAM: Record<string, string> = { pct: "Level", kw: "Power", amps: "Current", enabled: "Allowed", mode: "Mode", minutes: "Minutes" }
const paramLabel = (action: string, name: string) => (action === "set_reserve" && name === "pct" ? "Reserve" : (PARAM[name] ?? label(name)))

/** "YYYY-MM-DDTHH:mm" in the browser's time, for datetime-local inputs. */
const localInput = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const defaults = (a: ProfileActionView, d: DeviceDetail): Record<string, string | boolean> =>
  Object.fromEntries(
    Object.entries(a.params)
      .filter(([, spec]) => spec.type !== "time")
      .map(([name, spec]) => {
        if (spec.type === "boolean") return [name, false]
        const current = a.id === "set_reserve" && name === "pct" ? d.latest?.reserve_pct : undefined
        return [name, String(current ?? spec.min ?? 0)]
      })
  )

/**
 * Devices → Control (App v2): ask for a change to this device. It becomes a manual request that
 * goes through the same checks as a rule's proposal and waits in the Inbox for approval.
 */
export function ProposeChange({ device }: { device: DeviceDetail }) {
  const actions = useMemo(() => proposable(device), [device])
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [actionId, setActionId] = useState(() => actions.find((a) => a.id === "set_reserve")?.id ?? actions[0]?.id ?? "")
  const action = actions.find((a) => a.id === actionId)
  const [values, setValues] = useState(() => (action ? defaults(action, device) : {}))
  const [span, setSpan] = useState(() => {
    const start = Math.ceil((Date.now() + 2 * MIN) / (5 * MIN)) * 5 * MIN
    return { start: localInput(start), end: localInput(start + Math.min(60, action?.maxDurationMin ?? 60) * MIN) }
  })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  if (!action) return null

  const choose = (id: string) => {
    const next = actions.find((a) => a.id === id)!
    setActionId(id)
    setValues(defaults(next, device))
    setError("")
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const start = new Date(span.start)
    const end = new Date(span.end)
    if (!(end > start)) return setError("The change must end after it starts.")
    if (action.maxDurationMin && end.getTime() - start.getTime() > action.maxDurationMin * MIN)
      return setError(`This change can last at most ${action.maxDurationMin} minutes.`)
    const params: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(action.params)) {
      if (spec.type === "time") params[name] = end.toISOString()
      else if (spec.type === "boolean") params[name] = values[name] === true
      else params[name] = Number(values[name])
    }
    setBusy(true)
    setError("")
    try {
      await proposeChange({ deviceId: device.id, action: action.id, params, window: { start: start.toISOString(), end: end.toISOString() } })
      toast({ description: "Added to the Inbox for approval." })
      void queryClient.invalidateQueries({ queryKey: ["inbox"] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request couldn't be sent.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5" aria-label="Propose a change">
      {actions.length > 1 ? (
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Change
          <select value={actionId} onChange={(e) => choose(e.target.value)} className={input}>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a.id)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="m-0 text-xs text-app-dm">{action.description}</p>
      {Object.entries(action.params).map(([name, spec]) =>
        spec.type === "time" ? null : spec.type === "boolean" ? (
          <label key={name} className="flex items-center gap-2 text-[13px] text-app-sb">
            <input type="checkbox" checked={values[name] === true} onChange={(e) => setValues({ ...values, [name]: e.target.checked })} />
            {paramLabel(action.id, name)}
          </label>
        ) : spec.min !== undefined && spec.max !== undefined ? (
          <label key={name} className="flex flex-col gap-1.5 text-[13px] text-app-sb">
            {paramLabel(action.id, name)} · {String(values[name])}
            {spec.unit ?? ""}
            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.unit === "%" ? 5 : spec.type === "integer" ? 1 : Math.max(0.5, (spec.max - spec.min) / 200)}
              value={String(values[name])}
              onChange={(e) => setValues({ ...values, [name]: e.target.value })}
            />
          </label>
        ) : (
          <label key={name} className="flex flex-col gap-1 text-[13px] text-app-sb">
            {paramLabel(action.id, name)}
            {spec.unit ? ` (${spec.unit})` : ""}
            <input type="number" value={String(values[name])} onChange={(e) => setValues({ ...values, [name]: e.target.value })} className={input} />
          </label>
        )
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          From
          <input type="datetime-local" value={span.start} onChange={(e) => setSpan({ ...span, start: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-app-sb">
          Until
          <input type="datetime-local" value={span.end} onChange={(e) => setSpan({ ...span, end: e.target.value })} className={input} />
        </label>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-xs text-[#ff7a59]">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="h-[34px] self-start rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx disabled:opacity-70">
        {busy ? "Sending…" : action.id === "set_reserve" ? "Propose reserve change" : "Propose change"}
      </button>
    </form>
  )
}
