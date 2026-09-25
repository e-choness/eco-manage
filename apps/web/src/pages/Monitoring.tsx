import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { displayKw, type DeviceView } from "@ecomanage/shared"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getDevice, getDevices, getDeviceTelemetry } from "@/api/devices"

// Devices on the v2 data (P1-09): list, and for the selected device its profile, commissioning,
// last raw message and a 24-hour hourly chart. The App v2 Devices screen (P4-04) replaces it and
// adds the installer's scan and commission flow.

const STATUS_COLOR: Record<string, string> = { live: "bg-green-500", stale: "bg-yellow-500", offline: "bg-red-500", pending: "bg-gray-500" }

const kw = (d: DeviceView) => (d.latest ? `${displayKw(d.type, d.latest.p_kw).toFixed(1)} kW` : "—")

function DeviceDetailCard({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ["device", id], queryFn: () => getDevice(id) })
  const series = useQuery({ queryKey: ["device", id, "telemetry"], queryFn: () => getDeviceTelemetry(id) })
  const d = detail.data
  if (!d) return <p className="text-muted-foreground">Loading device…</p>
  const points = (series.data?.points ?? []).map((p) => ({ hour: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit" }), kw: Math.abs(p.p_kw) }))
  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="device-detail-name">{d.name}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {d.profile ? `${d.profile.model} · ${d.profile.protocol}` : "No profile"} · {d.address || "no address"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis unit=" kW" />
              <Tooltip />
              <Area type="monotone" dataKey="kw" stroke="#3ecf8e" fill="#3ecf8e33" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Profile</dt>
          <dd>{d.profileId ?? "—"}</dd>
          <dt className="text-muted-foreground">Data quality</dt>
          <dd>{d.quality ?? "no data"}</dd>
          <dt className="text-muted-foreground">Commissioned</dt>
          <dd>{d.commissionedAt ? `${new Date(d.commissionedAt).toLocaleDateString()} · ${d.commissionedBy?.name ?? "unknown"}` : "not yet"}</dd>
          <dt className="text-muted-foreground">Remote fixes</dt>
          <dd>{d.profile?.fixes.join(", ") || "none"}</dd>
        </dl>
        <div>
          <p className="text-sm text-muted-foreground mb-1">Last message</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto" data-testid="device-raw">
            {d.latest ? JSON.stringify(d.latest) : "no data"}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

export function Monitoring() {
  const list = useQuery({ queryKey: ["devices"], queryFn: getDevices, refetchInterval: 30_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const devices = (list.data?.items ?? []).filter((d) => d.type !== "gateway")
  const current = selected ?? devices[0]?.id ?? null

  if (list.isLoading) return <p className="text-muted-foreground">Loading devices…</p>
  if (list.error) return <p className="text-red-600">Could not load devices: {(list.error as Error).message}</p>

  const offline = devices.filter((d) => d.status !== "live").length
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Devices</h1>
        <p className="text-sm text-muted-foreground">
          {devices.length} devices · {devices.length - offline} live · {offline} not live
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <tbody>
                {devices.map((d) => (
                  <tr
                    key={d.id}
                    className={`border-t cursor-pointer ${d.id === current ? "bg-muted" : ""}`}
                    onClick={() => setSelected(d.id)}
                    data-testid={`device-row-${d.id}`}
                  >
                    <td className="py-2">{d.name}</td>
                    <td>
                      <Badge className={`${STATUS_COLOR[d.status] ?? "bg-gray-500"} text-white`}>{d.status}</Badge>
                    </td>
                    <td className="text-right">{kw(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        {current && <DeviceDetailCard id={current} />}
      </div>
    </div>
  )
}
