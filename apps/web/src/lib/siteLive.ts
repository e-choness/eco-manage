import { batteryLive, siteFlows, type SiteEvent, type SiteSnapshot } from "@ecomanage/shared"

// Applies one stream event to the snapshot the page already has. Flows and battery are worked out
// with the same shared functions the API uses for the snapshot, so both always agree.
export const applySiteEvent = (snapshot: SiteSnapshot, event: SiteEvent, now = new Date()): SiteSnapshot => {
  switch (event.type) {
    case "telemetry": {
      const devices = snapshot.devices.map((d) =>
        d.id === event.deviceId ? { ...d, latest: event.reading, lastSeenAt: now.toISOString() } : d
      )
      const battery = devices.find((d) => d.type === "battery")
      return { ...snapshot, now: now.toISOString(), devices, flows: siteFlows(devices, now), battery: batteryLive(battery?.latest ?? null) }
    }
    case "demand":
      return { ...snapshot, demand: { ...event.demand, quality: event.quality } }
    case "device":
      return {
        ...snapshot,
        devices: snapshot.devices.map((d) => (d.id === event.deviceId ? { ...d, status: event.status as typeof d.status } : d)),
      }
    default:
      return snapshot
  }
}

export interface StreamEvent {
  event: string
  data: unknown
}

/** Splits a server-sent-events byte stream into events. Comment lines (heartbeats) are skipped. */
export const createSseParser = (onEvent: (e: StreamEvent) => void) => {
  let buffer = ""
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n")
    let idx: number
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = "message"
      const data: string[] = []
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
      }
      if (data.length === 0) continue
      try {
        onEvent({ event, data: JSON.parse(data.join("\n")) })
      } catch {
        // ignore malformed events
      }
    }
  }
}
