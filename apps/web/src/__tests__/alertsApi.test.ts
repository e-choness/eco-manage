import { describe, expect, it } from "vitest"
import { fromView } from "@/api/alerts"

describe("v2 alerts on the current Alerts page", () => {
  const view = {
    id: "a1",
    siteId: "s1",
    deviceId: "ev3",
    ruleId: "device-silent" as const,
    severity: "warning" as const,
    title: "Device not reporting",
    detail: "EV charger 3: no data for 7 min",
    condition: "active" as const,
    openedAt: "2026-09-25T16:33:00.000Z",
    lastSeenAt: "2026-09-25T16:40:00.000Z",
    count: 1,
    resolvedAt: null,
  }

  it("maps state onto read and resolved", () => {
    expect(fromView({ ...view, state: "open" })).toEqual({
      _id: "a1",
      title: "Device not reporting",
      message: "EV charger 3: no data for 7 min",
      type: "warning",
      timestamp: "2026-09-25T16:33:00.000Z",
      read: false,
      resolved: false,
    })
    expect(fromView({ ...view, state: "ack" })).toMatchObject({ read: true, resolved: false })
    expect(fromView({ ...view, state: "resolved" })).toMatchObject({ read: true, resolved: true })
  })
})
