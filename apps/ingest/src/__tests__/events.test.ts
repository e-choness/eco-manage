import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import type { TelemetryReading } from '@ecomanage/shared'
import { DemandTracker, EventPublisher } from '../events'

const reading = (ts: string, p: number, eIn?: number): TelemetryReading => ({ ts, p_kw: p, ...(eIn !== undefined ? { e_in_kwh: eIn } : {}), q: 'ok' })

describe('EventPublisher', () => {
  let sent: { channel: string; event: { type: string; reading?: TelemetryReading } ; at: number }[]
  let publisher: EventPublisher

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-24T16:40:00Z') })
    sent = []
    const redis = { publish: (channel: string, msg: string) => (sent.push({ channel, event: JSON.parse(msg), at: Date.now() }), Promise.resolve(1)) }
    publisher = new EventPublisher(redis as unknown as Redis)
  })

  afterEach(() => {
    publisher.stop()
    vi.useRealTimers()
  })

  it('sends the first reading at once, on the site channel', () => {
    publisher.telemetry('s1', 'd1', reading('2026-09-24T16:40:00Z', 1))
    expect(sent).toEqual([{ channel: 'site:s1:events', event: { type: 'telemetry', deviceId: 'd1', reading: reading('2026-09-24T16:40:00Z', 1) }, at: Date.now() }])
  })

  it('sends at most one event per device every 5 s, and the latest value within 5 s', () => {
    // A device reporting every second for 20 seconds
    for (let i = 0; i < 20; i++) {
      publisher.telemetry('s1', 'd1', reading(new Date(Date.now()).toISOString(), i))
      vi.advanceTimersByTime(1000)
    }
    vi.advanceTimersByTime(5000)
    const times = sent.map((s) => s.at)
    const gaps = times.slice(1).map((t, i) => t - times[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5000)
    expect(sent.at(-1)!.event.reading!.p_kw).toBe(19)
    // every reading was delivered or superseded within 5 s
    for (let i = 0; i < 20; i++) {
      const produced = Date.parse('2026-09-24T16:40:00Z') + i * 1000
      const deliveredBy = sent.find((s) => s.at >= produced && s.event.reading!.p_kw >= i)!.at
      expect(deliveredBy - produced).toBeLessThanOrEqual(5000)
    }
  })

  it('throttles devices independently', () => {
    publisher.telemetry('s1', 'd1', reading('x', 1))
    publisher.telemetry('s1', 'd2', reading('x', 2))
    publisher.demand('s1', { intervalStart: 'x', soFarKw: 1, projectedKw: 2 }, 'ok')
    expect(sent).toHaveLength(3)
  })
})

describe('DemandTracker', () => {
  it('carries the import counter across the interval boundary', () => {
    const d = new DemandTracker()
    d.update('m', reading('2026-09-24T19:14:55Z', 120, 1000))
    // 5 s later, first reading of the new interval: 120 kW over 5 s since 19:14:55 = 0.1667 kWh
    const r = d.update('m', reading('2026-09-24T19:20:00Z', 120, 1010.1667))!
    expect(r.quality).toBe('ok')
    expect(r.demand.intervalStart).toBe('2026-09-24T19:15:00.000Z')
    expect(r.demand.soFarKw).toBeCloseTo(120, 0)
  })

  it('back-calculates the start counter, as an estimate, when it starts mid-interval', () => {
    const d = new DemandTracker()
    const r = d.update('m', reading('2026-09-24T19:20:00Z', 96, 1008))!
    expect(r.quality).toBe('estimated')
    expect(r.demand.soFarKw).toBe(96)
  })

  it('treats a start within a minute of the boundary as exact', () => {
    const d = new DemandTracker()
    expect(d.update('m', reading('2026-09-24T19:15:30Z', 50, 1000))!.quality).toBe('ok')
  })

  it('ignores out-of-order readings and readings without a counter', () => {
    const d = new DemandTracker()
    d.update('m', reading('2026-09-24T19:20:00Z', 96, 1008))
    expect(d.update('m', reading('2026-09-24T19:19:00Z', 96, 1006))).toBeNull()
    expect(d.update('m', reading('2026-09-24T19:21:00Z', 96))).toBeNull()
  })
})
