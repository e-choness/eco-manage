import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CommissionResult, FoundDevice } from "@ecomanage/shared"
import { commissionDevice, createDevice } from "@/api/devices"
import { useToast } from "@/hooks/useToast"

// The checks the gateway runs when commissioning (Data and Device Audit §4 step 5), shown as
// "waiting" until the result arrives.
const EXPECTED_CHECKS = ["Live read", "Sign check: import positive", "Energy balance within 5%"]

type Scan = { state: "scanning" } | { state: "done"; found: FoundDevice[] } | { state: "error"; message: string }

/**
 * Devices → Scan for devices (installers, App v2): what the gateway found that the site doesn't
 * have, and commissioning each one with the live check list.
 */
export function ScanPanel({ scan, onCommissioned }: { scan: Scan; onCommissioned: (deviceId: string) => void }) {
  const title = scan.state === "scanning" ? "Scanning the site network…" : scan.state === "error" ? "The scan didn't finish" : scan.found.length ? `${scan.found.length} new device${scan.found.length > 1 ? "s" : ""} found` : "No new devices found"
  return (
    <section aria-label="Scan results" className="flex flex-col gap-3 rounded-[14px] border border-app-l2 bg-app-ps px-5 py-[18px]">
      <div className="flex justify-between text-[13px]">
        <span className="font-semibold" role="status">
          {title}
        </span>
        <span className="text-app-dm">LAN · RS-485 ids 1–247 · OCPP</span>
      </div>
      {scan.state === "error" ? <p className="m-0 text-[13px] text-app-sb">{scan.message}</p> : null}
      {scan.state === "done" ? scan.found.map((f) => <Found key={f.address} found={f} onCommissioned={onCommissioned} />) : null}
    </section>
  )
}

export type { Scan }

function Found({ found, onCommissioned }: { found: FoundDevice; onCommissioned: (deviceId: string) => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CommissionResult | null>(null)
  const [error, setError] = useState("")

  const commission = async () => {
    setRunning(true)
    setError("")
    setResult(null)
    try {
      // Add the device record first (pending), then let the gateway commission it.
      const id = deviceId ?? (await createDevice({ type: found.type, name: found.name, profileId: found.profileId, address: found.address, role: "" })).id
      setDeviceId(id)
      const r = await commissionDevice(id)
      setResult(r)
      void queryClient.invalidateQueries({ queryKey: ["devices"] })
      if (r.ok) {
        toast({ description: `${found.name} is live.` })
        onCommissioned(id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commissioning failed.")
    } finally {
      setRunning(false)
    }
  }

  const checks = result?.checks.length ? result.checks : EXPECTED_CHECKS.map((name) => ({ name, pass: null as boolean | null }))
  return (
    <article aria-label={found.name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] items-center gap-[18px] border-t border-app-l2 pt-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{found.name}</span>
        <span className="font-mono text-xs text-app-dm">
          {found.address}
          {found.modelCode ? ` · model code ${found.modelCode}` : ""}
        </span>
        <span className="text-xs text-app-dm">Profile {found.profileId ? `${found.profileId} (matched by model code)` : "not matched: pick one after adding"}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Checks">
        {checks.map((c) => {
          const state = c.pass === true ? "passed" : c.pass === false ? "failed" : running ? "running" : "waiting"
          const colour = state === "passed" ? "text-tag-bat" : state === "failed" ? "text-tag-hp" : state === "running" ? "text-tag-pv" : "text-app-dm"
          return (
            <li key={c.name} className={`flex items-center gap-2 text-[13px] ${colour}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              {c.name} · {state}
            </li>
          )
        })}
        {error || (result && !result.ok) ? (
          <li role="alert" className="text-xs text-tag-hp">
            {error || result?.error}
          </li>
        ) : null}
      </ul>
      {result?.ok ? (
        <span className="text-[13px] font-medium text-tag-bat">Live</span>
      ) : (
        <button type="button" onClick={() => void commission()} disabled={running} className="h-[34px] rounded-lg bg-[#3ecf8e] px-3.5 text-[13px] font-semibold text-[#06140d] disabled:opacity-70">
          {running ? "Checking…" : result || error ? "Try again" : "Commission"}
        </button>
      )}
    </article>
  )
}
