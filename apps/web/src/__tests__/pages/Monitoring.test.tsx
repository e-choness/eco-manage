import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { DeviceDetail, DeviceView } from '@ecomanage/shared'
import { server } from '../setup'
import { Monitoring } from '@/pages/Monitoring'

const BASE = 'http://localhost:3000'
const view = (id: string, name: string, type: DeviceView['type'], status: DeviceView['status'], p: number | null): DeviceView => ({
  id, siteId: 's', type, name, profileId: null, address: '', role: '', status, ratedKw: null, capacityKwh: null,
  lastSeenAt: null, commissionedAt: null, quality: p === null ? null : 'ok',
  latest: p === null ? null : { ts: '2026-09-24T16:40:00Z', p_kw: p, q: 'ok' },
})
const items = [view('a', 'Inverter A', 'pv', 'live', 36.1), view('e3', 'EV charger 3', 'ev', 'stale', null), view('g', 'Gateway', 'gateway', 'live', null)]
const detail = (id: string): DeviceDetail => ({
  ...items.find((d) => d.id === id)!,
  commissionedAt: '2024-03-14T15:00:00Z',
  commissionedBy: { id: 'u', name: 'Northside Solar' },
  profile: { id: 'p', vendor: 'v', model: 'Three-phase string inverter', protocol: 'modbus-tcp', pollMs: 5000, writeActions: [], fixes: ['Remote restart'] },
  maintenance: [],
})

describe('Devices (Monitoring) page', () => {
  it('lists devices, hides the gateway, and shows the selected device', async () => {
    server.use(
      http.get(`${BASE}/api/devices`, () => HttpResponse.json({ items })),
      http.get(`${BASE}/api/devices/:id`, ({ params }) => HttpResponse.json(detail(String(params.id)))),
      http.get(`${BASE}/api/devices/:id/telemetry`, () => HttpResponse.json({ res: 'h', capped: false, points: [] }))
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Monitoring />
      </QueryClientProvider>
    )
    expect(await screen.findByText('2 devices · 1 live · 1 not live')).toBeInTheDocument()
    expect(screen.queryByText('Gateway')).not.toBeInTheDocument()
    expect(screen.getByTestId('device-row-a')).toHaveTextContent('36.1 kW')
    expect(await screen.findByTestId('device-detail-name')).toHaveTextContent('Inverter A')
    expect(screen.getByTestId('device-raw')).toHaveTextContent('"p_kw":36.1')

    await userEvent.click(screen.getByTestId('device-row-e3'))
    await waitFor(() => expect(screen.getByTestId('device-detail-name')).toHaveTextContent('EV charger 3'))
    expect(screen.getByTestId('device-raw')).toHaveTextContent('no data')
  })
})
