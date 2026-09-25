import { displayKw, type SiteSnapshot } from "@ecomanage/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useSiteLive } from "@/hooks/useSiteLive"

// Minimal live view on the v2 data (P1-08). The App v2 Home with the 3D scene replaces it in P4-03.

const kw = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)} kW`)

const age = (iso: string | null | undefined, now: number) => {
  if (!iso) return "no data"
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

const STATUS_COLOR: Record<string, string> = {
  live: "bg-green-500",
  stale: "bg-yellow-500",
  offline: "bg-red-500",
  pending: "bg-gray-500",
}

function Flows({ s }: { s: SiteSnapshot }) {
  const f = s.flows
  const tiles: [string, string, string][] = [
    ["Solar", kw(f.pv), "flow-pv"],
    ["Battery", f.battery >= 0 ? `${kw(f.battery)} out` : `${kw(-f.battery)} in`, "flow-battery"],
    ["Grid", f.grid === null ? "—" : f.grid >= 0 ? `${kw(f.grid)} import` : `${kw(-f.grid)} export`, "flow-grid"],
    ["EV charging", kw(-f.ev), "flow-ev"],
    ["Heat pump", kw(-f.heatpump), "flow-hp"],
    ["Building (calculated)", kw(f.building), "flow-building"],
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {tiles.map(([label, value, id]) => (
        <Card key={id}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid={id}>
              {value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function Live() {
  const { data: s, isLoading, error, connected, lastEventAt } = useSiteLive()
  const now = lastEventAt ?? Date.now()

  if (isLoading) return <p className="text-muted-foreground">Loading live data…</p>
  if (error || !s) return <p className="text-red-600">Could not load the site: {(error as Error)?.message}</p>

  const cap = s.site.demandCapKw
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="site-name">
            {s.site.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {s.gateway ? `Gateway ${s.gateway.online ? "online" : "offline"} · ${s.gateway.buffered} buffered` : "No gateway data"}
          </p>
        </div>
        <Badge className={connected ? "bg-green-500 text-white" : "bg-gray-500 text-white"} data-testid="live-status">
          {connected ? "Live" : "Reconnecting…"}
        </Badge>
      </div>

      <Flows s={s} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">15-minute demand</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="demand-now">
              {s.demand ? kw(s.demand.soFarKw) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {s.demand ? `heading for ${kw(s.demand.projectedKw)}${s.demand.quality === "estimated" ? " (estimated)" : ""}` : "no meter data"}
              {cap ? ` · cap ${cap} kW` : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Month peak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s.monthPeak ? kw(s.monthPeak.kw) : "—"}</div>
            <p className="text-xs text-muted-foreground">{s.monthPeak ? new Date(s.monthPeak.at).toLocaleString() : "no intervals yet"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Battery</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="battery-soc">
              {s.battery.socPct === null ? "—" : `${s.battery.socPct.toFixed(0)}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              reserve {s.battery.reservePct ?? "—"}%
              {s.battery.minutesLeft !== null ? ` · ${Math.floor(s.battery.minutesLeft / 60)} h ${s.battery.minutesLeft % 60} min left` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Device</th>
                <th>Status</th>
                <th className="text-right">Power</th>
                <th className="text-right">Last reading</th>
              </tr>
            </thead>
            <tbody>
              {s.devices
                .filter((d) => d.type !== "gateway")
                .map((d) => (
                  <tr key={d.id} className="border-t" data-testid={`device-${d.id}`}>
                    <td className="py-2">{d.name}</td>
                    <td>
                      <Badge className={`${STATUS_COLOR[d.status] ?? "bg-gray-500"} text-white`}>{d.status}</Badge>
                    </td>
                    <td className="text-right" data-testid={`device-kw-${d.id}`}>
                      {d.latest ? kw(displayKw(d.type, d.latest.p_kw)) : "—"}
                    </td>
                    <td className="text-right text-muted-foreground">{age(d.latest?.ts, now)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
