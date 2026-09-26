/**
 * P4-03: App v2 Home. Live flows (drawn flat here: jsdom has no WebGL), demand, bill and battery,
 * the top of the Inbox with approve and decline, and today's price strip.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { InboxCounts, InboxItem, Role, SiteSnapshot, SiteToday } from '@ecomanage/shared'
import { server } from '../setup'
import { Home } from '@/pages/Home'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'
const TZ = 'America/Toronto'
const now = Date.now()
const ts = (msAgo = 1000) => new Date(now - msAgo).toISOString()
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString()
const MIN = 60_000

beforeAll(() => {
  // jsdom has no canvas: say so quietly, so the scene uses its 2D fallback.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

const snapshot: SiteSnapshot = {
  site: { id: 's1', name: 'Maple Grove School', tz: TZ, currency: 'CAD', demandCapKw: 120, billDay: 1 },
  now: ts(0),
  devices: [
    { id: 'pv', name: 'Inverter A', type: 'pv', status: 'live', profileId: null, ratedKw: 50, capacityKwh: null, lastSeenAt: ts(), latest: { ts: ts(), p_kw: 36.1, q: 'ok' } },
    { id: 'bat', name: 'Battery', type: 'battery', status: 'live', profileId: null, ratedKw: 60, capacityKwh: 200, lastSeenAt: ts(), latest: { ts: ts(), p_kw: 20, q: 'ok' } },
    { id: 'm', name: 'Grid meter', type: 'meter', status: 'live', profileId: null, ratedKw: null, capacityKwh: null, lastSeenAt: ts(), latest: { ts: ts(), p_kw: 12.8, q: 'ok' } },
  ],
  flows: { pv: 36.1, battery: 20, grid: 12.8, ev: 0, heatpump: 0, building: 68.9, stale: [] },
  battery: { socPct: 68, reservePct: 20, usableKwh: 200, pKw: 20, minutesLeft: 290 },
  demand: { intervalStart: ts(5 * MIN), soFarKw: 88, projectedKw: 91, quality: 'ok' },
  monthPeak: { kw: 112, at: ts(86_400_000) },
  gateway: { online: true, buffered: 0, fw: '1.4.2', receivedAt: ts() },
}

const dayStart = now - 10 * 3_600_000
const today: SiteToday = {
  date: '2026-09-24',
  currency: 'CAD',
  prices: [
    { name: 'Off-peak', rateCents: 9, level: 'off', start: new Date(dayStart).toISOString(), end: iso(80 * MIN) },
    { name: 'Peak', rateCents: 27, level: 'peak', start: iso(80 * MIN), end: iso(5 * 3_600_000) },
    { name: 'Mid', rateCents: 16, level: 'mid', start: iso(5 * 3_600_000), end: new Date(dayStart + 86_400_000).toISOString() },
  ],
  bill: { period: '2026-09', totalCents: 341_800, projectedCents: 385_800, savedCents: 124_000 },
}

const item = (type: InboxItem['type'], id: string, over: Partial<InboxItem> = {}): InboxItem => ({
  key: `${type}:${id}`,
  type,
  id,
  kind: type === 'decide' ? 'Decision' : type === 'alert' ? 'Alert' : 'Active',
  title: 'x',
  deviceId: 'bat',
  deviceName: 'Battery',
  sub: '',
  status: 'open',
  at: ts(),
  due: null,
  ...over,
})

const inbox: InboxItem[] = [
  item('active', 'c1', { title: 'Charge battery' }),
  item('decide', 'r1', { title: 'Discharge battery at 30 kW, 14:00–17:00', sub: 'Battery · expected saving $266', due: iso(65 * MIN) }),
  item('alert', 'a1', { title: 'Device not reporting', sub: 'EV charger 3 · open', deviceId: 'ev3', deviceName: 'EV charger 3' }),
]
const counts: InboxCounts = { open: { decide: 1, alert: 1, active: 1, all: 3 }, closed: { decide: 0, alert: 0, active: 0, all: 0 } }
const none: InboxCounts = { open: { decide: 0, alert: 0, active: 0, all: 0 }, closed: counts.closed }

const calls = { approve: [] as string[], decline: [] as unknown[], inbox: 0 }

const setup = (role: Role, over: { snapshot?: SiteSnapshot; today?: SiteToday; empty?: boolean } = {}) => {
  calls.approve = []
  calls.decline = []
  calls.inbox = 0
  const snap = over.snapshot ?? snapshot
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'u@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json(snap)),
    http.get(`${BASE}/api/site/stream`, () => {
      const body = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`)) })
      return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
    http.get(`${BASE}/api/site/model`, () => HttpResponse.json({ version: 0, source: 'default', hub: [0, 1, 2], anchors: [], buildingLabel: [0, 3, 0], camera: { view: 'fit' } })),
    http.get(`${BASE}/api/site/today`, () => HttpResponse.json(role === 'installer' ? { ...(over.today ?? today), bill: null } : (over.today ?? today))),
    http.get(`${BASE}/api/inbox`, () => {
      calls.inbox++
      return HttpResponse.json({ items: over.empty ? [] : inbox, counts: over.empty ? none : counts, nextCursor: null })
    }),
    http.get(`${BASE}/api/inbox/counts`, () => HttpResponse.json(over.empty ? none : counts)),
    http.post(`${BASE}/api/recommendations/:id/approve`, ({ params }) => {
      calls.approve.push(String(params.id))
      return HttpResponse.json({ commandId: 'c9' })
    }),
    http.post(`${BASE}/api/recommendations/:id/decline`, async ({ request, params }) => {
      calls.decline.push({ id: params.id, body: await request.json() })
      return HttpResponse.json({})
    })
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider defaultTheme="dark" storageKey="t">
        <MemoryRouter>
          <SiteStreamProvider>
            <Home />
          </SiteStreamProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

describe('Home', () => {
  it('shows live flows, demand, bill and battery to a manager', async () => {
    setup('manager')
    expect(await screen.findByTestId('site-name')).toHaveTextContent('Maple Grove School')
    await waitFor(() => expect(screen.getByTestId('live-status')).toHaveTextContent('live'))
    expect(screen.getByTestId('site-name').nextElementSibling?.textContent).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d\d:\d\d · live$/)
    expect(screen.getByTestId('scene-2d')).toBeInTheDocument()
    expect(screen.getByTestId('scene-label-grid')).toHaveTextContent('Grid12.8 kWimporting')
    expect(screen.getByTestId('scene-label-battery')).toHaveTextContent('68% · discharging')
    expect(screen.queryByTestId('scene-label-ev')).toBeNull() // the site has no EV chargers
    expect(screen.getByRole('table', { name: 'Power flows now' })).toHaveTextContent('Solar36.1into the site')

    const demand = screen.getByRole('region', { name: 'Demand' })
    expect(within(demand).getByTestId('demand-now')).toHaveTextContent('88 kW')
    expect(demand).toHaveTextContent('cap 120 kW')
    expect(demand).toHaveTextContent(/Projected 91 kW for \d\d:\d\d–\d\d:\d\d · month peak 112/)
    expect(await screen.findByTestId('bill-so-far')).toHaveTextContent('$3,418')
    expect(screen.getByRole('region', { name: 'Bill so far' })).toHaveTextContent('heading for $3,858$1,240 saved')
    expect(screen.getByTestId('battery-soc')).toHaveTextContent('68%')
    expect(screen.getByRole('region', { name: 'Battery' })).toHaveTextContent('About 4 h 50 min to reserve at 20 kW')
  })

  it("shows today's prices with the next peak", async () => {
    setup('owner')
    await waitFor(() => expect(screen.getAllByTestId('price-seg')).toHaveLength(3))
    expect(screen.getAllByTestId('price-seg').map((s) => s.textContent)).toEqual(['off-peak $0.09', 'peak $0.27', 'mid $0.16'])
    expect(screen.getByTestId('next-peak')).toHaveTextContent(/^Peak starts \d\d:\d\d · in 1 h 20 min$/)
    expect(screen.getByTestId('price-now')).toBeInTheDocument()
  })

  it('lists what needs someone, and approves a decision from Home', async () => {
    setup('manager')
    const needs = await screen.findByRole('region', { name: 'Needs you' })
    await waitFor(() => expect(within(needs).getByTestId('needs-count')).toHaveTextContent('2 items'))
    expect(within(needs).getByRole('button', { name: '1 active: Battery · view' })).toBeInTheDocument()
    const decision = within(needs).getByRole('article', { name: 'Discharge battery at 30 kW, 14:00–17:00' })
    expect(decision).toHaveTextContent('Decision · Battery')
    expect(decision).toHaveTextContent('Battery · expected saving $266')
    expect(within(needs).getByRole('article', { name: 'Device not reporting' })).toHaveTextContent('Alert')
    const before = calls.inbox
    await userEvent.click(within(decision).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.approve).toEqual(['r1']))
    await waitFor(() => expect(calls.inbox).toBeGreaterThan(before)) // the list reloads
  })

  it('asks why before declining', async () => {
    setup('owner')
    const decision = await screen.findByRole('article', { name: 'Discharge battery at 30 kW, 14:00–17:00' })
    await userEvent.click(within(decision).getByRole('button', { name: 'Decline' }))
    await userEvent.click(within(decision).getByRole('button', { name: 'Decline' }))
    expect(within(decision).getByRole('alert')).toHaveTextContent('Say why, so the rule can be tuned.')
    await userEvent.type(within(decision).getByLabelText('Why not? It helps tune the rule.'), 'Buses need a full charge')
    await userEvent.click(within(decision).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.decline).toEqual([{ id: 'r1', body: { reason: 'Buses need a full charge' } }]))
  })

  it('shows installers no money and no approve buttons', async () => {
    setup('installer')
    const decision = await screen.findByRole('article', { name: 'Discharge battery at 30 kW, 14:00–17:00' })
    await waitFor(() => expect(decision).toHaveTextContent('Needs a manager or owner to approve'))
    expect(within(decision).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Bill so far' })).toBeNull()
  })

  it('says when there is no tariff and nothing needs anyone', async () => {
    setup('owner', { today: { ...today, prices: null }, empty: true })
    expect(await screen.findByText(/no tariff covers today yet/)).toBeInTheDocument()
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByTestId('needs-count')).toHaveTextContent('0 items')
    expect(screen.queryByRole('button', { name: /active/ })).toBeNull()
  })
})
