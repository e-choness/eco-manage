/**
 * P1-08: the live view maths shared by Home: applying stream events to the snapshot, and reading
 * the SSE stream in chunks.
 */
import { describe, it, expect } from 'vitest'
import type { SiteSnapshot } from '@ecomanage/shared'
import { applySiteEvent, createSseParser } from '@/lib/siteLive'

const now = new Date()
const ts = (msAgo = 1000) => new Date(now.getTime() - msAgo).toISOString()

const snapshot: SiteSnapshot = {
  site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 },
  now: now.toISOString(),
  devices: [
    { id: 'pv', name: 'Inverter A', type: 'pv', status: 'live', profileId: null, ratedKw: 50, capacityKwh: null, lastSeenAt: ts(), latest: { ts: ts(), p_kw: 36.1, q: 'ok' } },
    { id: 'm', name: 'Grid meter', type: 'meter', status: 'live', profileId: null, ratedKw: null, capacityKwh: null, lastSeenAt: ts(), latest: { ts: ts(), p_kw: 12.8, q: 'ok' } },
    { id: 'e1', name: 'EV charger 1', type: 'ev', status: 'live', profileId: null, ratedKw: 22, capacityKwh: null, lastSeenAt: ts(), latest: { ts: ts(), p_kw: -7.4, q: 'ok' } },
    { id: 'e3', name: 'EV charger 3', type: 'ev', status: 'stale', profileId: null, ratedKw: 22, capacityKwh: null, lastSeenAt: ts(420_000), latest: null },
  ],
  flows: { pv: 36.1, battery: 0, grid: 12.8, ev: -7.4, heatpump: 0, building: 41.5, stale: ['e3'] },
  battery: { socPct: 68, reservePct: 20, usableKwh: 200, pKw: 0, minutesLeft: null },
  demand: { intervalStart: ts(300_000), soFarKw: 88, projectedKw: 96, quality: 'ok' },
  monthPeak: { kw: 112, at: '2026-09-09T19:15:00.000Z' },
  gateway: { online: true, buffered: 0, fw: '1.4.2', receivedAt: ts() },
}

describe('applySiteEvent', () => {
  it('updates the device and recomputes flows from a telemetry event', () => {
    const next = applySiteEvent(snapshot, { type: 'telemetry', deviceId: 'pv', reading: { ts: ts(0), p_kw: 40, q: 'ok' } }, now)
    expect(next.devices[0].latest?.p_kw).toBe(40)
    expect(next.flows).toMatchObject({ pv: 40, grid: 12.8, building: 45.4 })
    expect(snapshot.devices[0].latest?.p_kw).toBe(36.1) // not mutated
  })

  it('applies demand and device status events, and ignores others', () => {
    expect(applySiteEvent(snapshot, { type: 'demand', demand: { intervalStart: 'x', soFarKw: 101, projectedKw: 130 }, quality: 'estimated' }).demand).toEqual({
      intervalStart: 'x',
      soFarKw: 101,
      projectedKw: 130,
      quality: 'estimated',
    })
    expect(applySiteEvent(snapshot, { type: 'device', deviceId: 'e3', status: 'offline' }).devices[3].status).toBe('offline')
    expect(applySiteEvent(snapshot, { type: 'alert' } as never)).toBe(snapshot)
  })
})

describe('createSseParser', () => {
  it('splits chunks into events, skipping heartbeats and bad data', () => {
    const events: unknown[] = []
    const feed = createSseParser((e) => events.push(e))
    feed('event: snapshot\ndata: {"a":')
    feed('1}\n\n: heartbeat\n\nevent: x\ndata: not json\n\ndata: {"b":2}\r\n\r\n')
    expect(events).toEqual([
      { event: 'snapshot', data: { a: 1 } },
      { event: 'message', data: { b: 2 } },
    ])
  })
})
