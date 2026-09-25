import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { SiteSnapshot } from '@ecomanage/shared'
import { server } from '../setup'
import { Live } from '@/pages/Live'
import { applySiteEvent, createSseParser } from '@/lib/siteLive'

const BASE = 'http://localhost:3000'
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

describe('Live page', () => {
  it('shows the snapshot, then values pushed over the stream', async () => {
    server.use(
      http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json(snapshot)),
      http.get(`${BASE}/api/site/stream`, () => {
        const enc = new TextEncoder()
        const body = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`))
            setTimeout(() => {
              c.enqueue(enc.encode(`event: telemetry\ndata: ${JSON.stringify({ type: 'telemetry', deviceId: 'pv', reading: { ts: new Date().toISOString(), p_kw: 44.4, q: 'ok' } })}\n\n`))
            }, 50)
          },
        })
        return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
      })
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Live />
      </QueryClientProvider>
    )
    expect(await screen.findByTestId('site-name')).toHaveTextContent('Maple Grove School')
    expect(screen.getByTestId('flow-grid')).toHaveTextContent('12.8 kW import')
    expect(screen.getByTestId('device-kw-e1')).toHaveTextContent('7.4 kW') // loads shown positive
    expect(screen.getByTestId('demand-now')).toHaveTextContent('88.0 kW')

    await waitFor(() => expect(screen.getByTestId('flow-pv')).toHaveTextContent('44.4 kW'))
    expect(screen.getByTestId('live-status')).toHaveTextContent('Live')
  })
})
