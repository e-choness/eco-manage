/**
 * P4-04: App v2 Devices. The list with live values, the device detail, proposing a change
 * (managers and owners), and the installer's scan, commission and maintenance log.
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { DeviceDetail, DeviceView, Role, SiteSnapshot } from '@ecomanage/shared'
import { server } from '../setup'
import { Devices } from '@/pages/Devices'
import { AuthProvider } from '@/contexts/AuthContext'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'
const now = Date.now()
const ts = (msAgo = 2000) => new Date(now - msAgo).toISOString()

const device = (id: string, type: DeviceView['type'], name: string, over: Partial<DeviceView> = {}): DeviceView => ({
  id,
  siteId: 's1',
  type,
  name,
  profileId: null,
  address: '',
  role: '',
  status: 'live',
  ratedKw: null,
  capacityKwh: null,
  lastSeenAt: ts(),
  commissionedAt: '2024-03-14T15:00:00Z',
  quality: 'ok',
  latest: { ts: ts(), p_kw: 0, q: 'ok' },
  ...over,
})

const list: DeviceView[] = [
  device('ev1', 'ev', 'EV charger 1', { ratedKw: 22, latest: { ts: ts(), p_kw: -7.4, q: 'ok' } }),
  device('bat', 'battery', 'Battery', { capacityKwh: 200, profileId: 'sunspec-storage-802@2', address: '10.0.4.21:502 · unit 1', latest: { ts: ts(), p_kw: 20, q: 'ok', reserve_pct: 20 } }),
  device('invA', 'pv', 'Inverter A', { ratedKw: 50, latest: { ts: ts(), p_kw: 36.1, q: 'ok' } }),
  device('ev3', 'ev', 'EV charger 3', { ratedKw: 22, status: 'offline', latest: null, lastSeenAt: ts(7 * 60_000) }),
  device('sub', 'submeter', 'Sub-meter · kitchen', { status: 'pending', commissionedAt: null, latest: null, lastSeenAt: null, address: 'RS-485 · id 7' }),
]

const batteryDetail: DeviceDetail = {
  ...list[1],
  commissionedBy: { id: 'u3', name: 'Northside Solar' },
  maintenance: [{ at: '2026-09-02T14:00:00Z', source: 'visit', text: 'Firmware 3.2.1 installed' }],
  profile: {
    id: 'sunspec-storage-802@2',
    vendor: 'SunSpec',
    model: 'Hybrid inverter with LFP battery',
    protocol: 'modbus-tcp',
    pollMs: 1000,
    writeActions: ['set_reserve', 'force_discharge', 'restart'],
    actions: [
      { id: 'set_reserve', description: 'Minimum state of charge kept for backup', params: { pct: { type: 'number', unit: '%', min: 10, max: 100 } }, maxDurationMin: null },
      { id: 'force_discharge', description: 'Discharge at a fixed power until the end time', params: { kw: { type: 'number', unit: 'kW', min: 0, max: 60 }, until: { type: 'time' } }, maxDurationMin: 360 },
      { id: 'restart', description: 'Restart', params: {}, maxDurationMin: null },
    ],
    fixes: [],
  },
}

const snapshot = {
  site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 },
  now: ts(0),
  devices: list.map((d) => (d.id === 'invA' ? { ...d, latest: { ts: ts(500), p_kw: 40.2, q: 'ok' as const } } : d)),
  flows: { pv: 40.2, battery: 20, grid: 0, ev: -7.4, heatpump: 0, building: 0, stale: [] },
  battery: { socPct: 68, reservePct: 20, usableKwh: 200, pKw: 20, minutesLeft: 290 },
  demand: null,
  monthPeak: null,
  gateway: null,
} as unknown as SiteSnapshot

const calls = { proposed: [] as unknown[], created: [] as unknown[], commissioned: [] as string[], visits: [] as unknown[] }

const setup = (role: Role, path = '/devices?device=bat') => {
  calls.proposed = []
  calls.created = []
  calls.commissioned = []
  calls.visits = []
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'u@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/devices`, () => HttpResponse.json({ items: list })),
    http.get(`${BASE}/api/devices/:id`, ({ params }) => HttpResponse.json(params.id === 'bat' ? batteryDetail : { ...list.find((d) => d.id === params.id), commissionedBy: null, maintenance: [], profile: null })),
    http.get(`${BASE}/api/devices/:id/telemetry`, () =>
      HttpResponse.json({ res: 'h', capped: false, points: Array.from({ length: 24 }, (_, i) => ({ ts: ts((24 - i) * 3_600_000), p_kw: i, min_kw: i, max_kw: i, n: 12, estimated: i === 3 })) })
    ),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json(snapshot)),
    http.get(`${BASE}/api/site/stream`, () => new HttpResponse(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)) }), { headers: { 'Content-Type': 'text/event-stream' } })),
    http.post(`${BASE}/api/recommendations`, async ({ request }) => {
      calls.proposed.push(await request.json())
      return HttpResponse.json({ id: 'r9' }, { status: 201 })
    }),
    http.post(`${BASE}/api/devices/scan`, () => HttpResponse.json({ found: [{ address: 'RS-485 · id 7', modelCode: 'CT3-100', profileId: 'ct-meter-3ph@2', type: 'submeter', name: 'Sub-meter · kitchen' }] })),
    http.post(`${BASE}/api/devices`, async ({ request }) => {
      calls.created.push(await request.json())
      return HttpResponse.json({ ...list[4], id: 'new1' }, { status: 201 })
    }),
    http.post(`${BASE}/api/devices/:id/commission`, ({ params }) => {
      calls.commissioned.push(String(params.id))
      return HttpResponse.json({
        ok: true,
        error: null,
        checks: [
          { name: 'Live read', pass: true },
          { name: 'Sign check: import positive', pass: true },
          { name: 'Energy balance within 5%', pass: true },
        ],
        device: { ...list[4], id: String(params.id) },
      })
    }),
    http.post(`${BASE}/api/devices/:id/maintenance`, async ({ request }) => {
      calls.visits.push(await request.json())
      return HttpResponse.json({ at: ts(0), source: 'visit', text: 'x' }, { status: 201 })
    })
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <SiteStreamProvider>
            <Devices />
          </SiteStreamProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

describe('Devices', () => {
  it('lists devices in App v2 order with live power, loads shown positive', async () => {
    setup('manager')
    const table = await screen.findByRole('table', { name: 'Devices' })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(6))
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'Inverter ASolar inverter · 50 kW',
      'BatteryBattery · 200 kWh',
      'Sub-meter · kitchenSub-meter',
      'EV charger 1EV charger · 22 kW',
      'EV charger 3EV charger · 22 kW',
    ])
    await waitFor(() => expect(screen.getByTestId('device-now-invA')).toHaveTextContent('40.2 kW')) // from the stream
    expect(screen.getByTestId('device-now-ev1')).toHaveTextContent('7.4 kW')
    expect(screen.getByTestId('device-now-ev3')).toHaveTextContent('—')
    expect(within(rows[4]).getByText('No data')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Not commissioned')).toBeInTheDocument()
    expect(screen.getByTestId('devices-summary')).toHaveTextContent('5 devices · 3 online · 1 no data · 1 not commissioned')
    expect(screen.queryByRole('button', { name: 'Scan for devices' })).toBeNull()
  })

  it('shows the selected device: 24 h, details, maintenance and the last message', async () => {
    setup('manager')
    const panel = await screen.findByRole('complementary', { name: 'Battery' })
    expect(within(panel).getByTestId('device-kw')).toHaveTextContent('20.0')
    await waitFor(() => expect(within(panel).getAllByTestId('spark-bar')).toHaveLength(24))
    expect(await within(panel).findByText('SunSpec Hybrid inverter with LFP battery')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Live · every 1 s')
    expect(panel).toHaveTextContent('14 Mar 2024 · Northside Solar')
    expect(panel).toHaveTextContent('Firmware 3.2.1 installed')
    expect(within(panel).getByTestId('device-raw')).toHaveTextContent('"reserve_pct":20')
  })

  it('lets a manager propose a reserve change for the Inbox', async () => {
    setup('manager')
    const form = await screen.findByRole('form', { name: 'Propose a change' })
    expect(within(form).getByRole('combobox', { name: 'Change' })).toHaveDisplayValue('Set reserve')
    expect(within(form).queryByRole('option', { name: 'Restart' })).toBeNull()
    fireEvent.change(within(form).getByRole('slider'), { target: { value: '35' } })
    await userEvent.click(within(form).getByRole('button', { name: 'Propose reserve change' }))
    await waitFor(() => expect(calls.proposed).toHaveLength(1))
    const body = calls.proposed[0] as { deviceId: string; action: string; params: unknown; window: { start: string; end: string } }
    expect(body).toMatchObject({ deviceId: 'bat', action: 'set_reserve', params: { pct: 35 } })
    expect(Date.parse(body.window.end) - Date.parse(body.window.start)).toBe(3_600_000)
  })

  it('fills an until parameter from the end of the window', async () => {
    setup('owner')
    const form = await screen.findByRole('form', { name: 'Propose a change' })
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Change' }), 'force_discharge')
    fireEvent.change(within(form).getByRole('slider'), { target: { value: '30' } })
    await userEvent.click(within(form).getByRole('button', { name: 'Propose change' }))
    await waitFor(() => expect(calls.proposed).toHaveLength(1))
    const body = calls.proposed[0] as { params: { kw: number; until: string }; window: { end: string } }
    expect(body.params).toEqual({ kw: 30, until: body.window.end })
  })

  it('shows installers the controls without changing them, and takes their visit notes', async () => {
    setup('installer')
    const panel = await screen.findByRole('complementary', { name: 'Battery' })
    expect(await within(panel).findByText('Installers can view controls. A manager or owner makes changes.')).toBeInTheDocument()
    expect(within(panel).queryByRole('form', { name: 'Propose a change' })).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Log a visit' }))
    await userEvent.type(within(panel).getByLabelText('What was done'), 'Checked the CT clamps')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.visits).toEqual([{ text: 'Checked the CT clamps' }]))
  })

  it('scans, then adds and commissions what the gateway found', async () => {
    setup('installer')
    await userEvent.click(await screen.findByRole('button', { name: 'Scan for devices' }))
    const results = await screen.findByRole('region', { name: 'Scan results' })
    expect(await within(results).findByText('1 new device found')).toBeInTheDocument()
    const found = within(results).getByRole('article', { name: 'Sub-meter · kitchen' })
    expect(found).toHaveTextContent('RS-485 · id 7 · model code CT3-100')
    expect(found).toHaveTextContent('Live read · waiting')
    await userEvent.click(within(found).getByRole('button', { name: 'Commission' }))
    await waitFor(() => expect(found).toHaveTextContent('Energy balance within 5% · passed'))
    expect(within(found).getByText('Live')).toBeInTheDocument()
    expect(calls.created).toEqual([{ type: 'submeter', name: 'Sub-meter · kitchen', profileId: 'ct-meter-3ph@2', address: 'RS-485 · id 7', role: '' }])
    expect(calls.commissioned).toEqual(['new1'])
  })

  it('commissions a pending device from its panel', async () => {
    setup('installer', '/devices?device=sub')
    const panel = await screen.findByRole('complementary', { name: 'Sub-meter · kitchen' })
    await userEvent.click(await within(panel).findByRole('button', { name: 'Commission' }))
    await waitFor(() => expect(panel).toHaveTextContent('Sign check: import positive · passed'))
    expect(calls.commissioned).toEqual(['sub'])
  })
})
