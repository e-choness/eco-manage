/**
 * P4-06: App v2 Bills. KPIs, every bill as a chart and a list, the selected period with its lines
 * and facts, utility bill upload (owner) and typed total, statement and CSV downloads, Open in
 * History, and spending for any range.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { BillDetail, BillSummary, BillsResponse, RangeSpend, Role } from '@ecomanage/shared'
import { server } from '../setup'
import { Bills } from '@/pages/Bills'
import { AuthProvider } from '@/contexts/AuthContext'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'
const downloads: string[] = []

// jsdom's File can't be streamed through msw's interceptor, so the upload call itself is replaced;
// it records the file and makes the next bill read show the worker reading it.
const h = vi.hoisted(() => ({ uploads: [] as string[], utility: null as BillSummary['utility'] }))
vi.mock('@/api/bills', async (original) => ({
  ...(await original<typeof import('@/api/bills')>()),
  uploadUtilityBill: async (period: string, file: File) => {
    h.uploads.push(`${period}:${file.name}`)
    h.utility = { status: 'processing', totalCents: null, diffCents: null, source: 'pdf', fileName: file.name, error: null, parsedAt: null }
    return { utility: h.utility }
  },
}))

beforeAll(() => {
  URL.createObjectURL = (() => 'blob:x') as never
  URL.revokeObjectURL = (() => undefined) as never
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  }
})

const lines = (demand: number) => ({ energyPkCents: 50_000, energyMdCents: 30_000, energyOpCents: 20_000, demandCents: demand, fixedCents: 9000, exportCreditCents: 1000 })
const bill = (period: string, start: string, end: string, over: Partial<BillSummary> = {}): BillSummary => ({
  period,
  start,
  end,
  inProgress: false,
  days: { elapsed: 31, total: 31 },
  totalCents: 250_000,
  projectedCents: null,
  lines: lines(142_000),
  peakKw: 104,
  peakAt: '2026-08-12T19:15:00.000Z',
  savedCents: 15_000,
  estimatedShare: 0,
  utility: null,
  ...over,
})

const items: BillSummary[] = [
  bill('2026-09', '2026-09-01T04:00:00.000Z', '2026-10-01T04:00:00.000Z', { inProgress: true, days: { elapsed: 24, total: 30 }, totalCents: 341_800, projectedCents: 385_800, lines: lines(240_000), peakKw: 112 }),
  bill('2026-08', '2026-08-01T04:00:00.000Z', '2026-09-01T04:00:00.000Z', { utility: { status: 'manual', totalCents: 248_500, diffCents: 1500, source: 'manual', fileName: null, error: null, parsedAt: null } }),
  bill('2026-07', '2026-07-01T04:00:00.000Z', '2026-08-01T04:00:00.000Z', { totalCents: 300_000, lines: lines(192_000), peakKw: 120 }),
]
const list: BillsResponse = {
  items,
  kpis: { last12: { totalCents: 550_000, from: '2026-07', to: '2026-08' }, saved12Cents: 30_000, peak12: { kw: 120, period: '2026-07', demandCents: 192_000 }, utilityDiffPct: 0.6, compared: 1 },
}
const detail = (b: BillSummary): BillDetail => ({
  ...b,
  energyKwh: { pk: 1850, md: 1875, op: 2222, export: 200 },
  gridKwh: 5947,
  tariff: { version: 2, name: 'TOU-D', demandRateCents: 1400, fixedCents: 9000 },
  tariffVersions: [1, 2],
  intervals: 2976,
  unpricedIntervals: 0,
  estimated: [{ start: '2026-08-17T06:10:00.000Z', end: '2026-08-17T08:40:00.000Z' }],
  savings: null,
  computedAt: '2026-09-01T05:00:00.000Z',
})
const spend: RangeSpend = {
  from: '2026-09-01',
  to: '2026-09-24',
  days: 24,
  energyCents: 90_000,
  lines: { energyPkCents: 50_000, energyMdCents: 25_000, energyOpCents: 15_000 },
  exportCreditCents: 800,
  gridKwh: 4200,
  exportKwh: 160,
  peak: { kw: 112, at: '2026-09-09T19:15:00.000Z' },
  tariffVersions: [2],
  intervals: 2304,
  estimatedShare: 0,
  unpricedIntervals: 0,
}

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

const calls = { totals: [] as unknown[], ranges: [] as string[] }

const setup = (role: Role, path = '/bills') => {
  h.uploads = []
  calls.totals = []
  calls.ranges = []
  downloads.length = 0
  h.utility = null
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'u@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json({ site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 }, devices: [], flows: {}, battery: {}, demand: null, monthPeak: null, gateway: null, now: '' })),
    http.get(`${BASE}/api/site/stream`, () => new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })),
    http.get(`${BASE}/api/bills`, () => HttpResponse.json(list)),
    http.get(`${BASE}/api/bills/range`, ({ request }) => {
      calls.ranges.push(new URL(request.url).search)
      return HttpResponse.json(spend)
    }),
    http.get(`${BASE}/api/bills/:period`, ({ params }) => {
      const b = items.find((x) => x.period === params.period)!
      return HttpResponse.json(detail(b.period === '2026-07' && h.utility ? { ...b, utility: h.utility } : b))
    }),
    http.get(`${BASE}/api/bills/:period/statement`, () => new HttpResponse('%PDF', { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="statement-2026-07.pdf"' } })),
    http.post(`${BASE}/api/bills/:period/utility-bill`, async ({ request }) => {
      calls.totals.push(await request.json())
      h.utility = { status: 'manual', totalCents: 301_000, diffCents: -1000, source: 'manual', fileName: null, error: null, parsedAt: null }
      return HttpResponse.json({ utility: h.utility })
    }),
    http.post(`${BASE}/api/exports`, () => HttpResponse.json({ id: 'ex1', from: '2026-07-01', to: '2026-07-31', status: 'done', rows: 2976, error: null, large: false, createdAt: '' }, { status: 202 })),
    http.get(`${BASE}/api/exports/ex1/file`, () => new HttpResponse('x', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="energy-2026-07-01-to-2026-07-31.csv"' } }))
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <SiteStreamProvider>
            <Routes>
              <Route path="/bills" element={<Bills />} />
              <Route path="/history" element={<Where />} />
            </Routes>
          </SiteStreamProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

describe('Bills', () => {
  it('shows the 12-month figures, every bill as bars and rows, and the open period', async () => {
    setup('manager')
    const figures = await screen.findByRole('list', { name: 'Bill figures' })
    expect((await within(figures).findAllByRole('listitem')).map((c) => c.textContent)).toEqual([
      'Last 12 months$5,500Jul 2026 – Aug 2026',
      'Saved, last 12 months$300vs buying all energy from the grid',
      'Highest demand, last 12 months120 kWJul 2026 · $1,920 demand charge',
      'Our estimate vs utility bills±0.6%1 bill compared',
    ])
    expect(screen.getAllByTestId('bill-bar').map((b) => b.getAttribute('aria-label'))).toEqual(['Jul 2026: $3,000', 'Aug 2026: $2,500', 'Sep 2026: $3,418 so far'])
    const rows = within(screen.getByRole('table', { name: 'Bills' })).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Sep 2026', '$3,418', '112 kW', 'In progress · 24 of 30 days'],
      ['Aug 2026', '$2,500', '104 kW', 'Utility $2,485 · ours +0.6%'],
      ['Jul 2026', '$3,000', '120 kW', 'Not uploaded'],
    ])
    const panel = screen.getByRole('complementary', { name: 'Bill Sep 2026' })
    expect(within(panel).getByTestId('bill-total')).toHaveTextContent('$3,418')
    expect(panel).toHaveTextContent('heading for $3,858')
    expect(panel).toHaveTextContent('estimate · in progress')
    expect(within(panel).getByTestId('utility-text')).toHaveTextContent('The utility bill arrives after the period closes.')
    expect(within(panel).queryByRole('button', { name: 'Upload utility bill' })).toBeNull()
  })

  it('opens a closed period with its lines and facts, and downloads its statement and data', async () => {
    setup('manager')
    await userEvent.click(await screen.findByRole('button', { name: 'Jul 2026: $3,000' }))
    const panel = await screen.findByRole('complementary', { name: 'Bill Jul 2026' })
    expect(within(panel).getByRole('list', { name: 'Bill lines' })).toHaveTextContent('Demand · 120 kW × $14.00$1,920')
    await waitFor(() => expect(panel).toHaveTextContent('Version 2 · demand $14.00/kW (energy priced with versions 1, 2)'))
    expect(panel).toHaveTextContent('17 Aug 02:10–04:40')
    expect(panel).toHaveTextContent('$150 vs buying all energy from the grid')
    expect(within(panel).queryByRole('button', { name: 'Upload utility bill' })).toBeNull() // managers don't upload
    await userEvent.click(within(panel).getByRole('button', { name: 'Statement (PDF)' }))
    await userEvent.click(within(panel).getByRole('button', { name: '15-min data (CSV)' }))
    await waitFor(() => expect(downloads).toEqual(['statement-2026-07.pdf', 'energy-2026-07-01-to-2026-07-31.csv']))
    await userEvent.click(within(panel).getByRole('button', { name: 'Open in History' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/history?from=2026-07-01&to=2026-07-31')
  })

  it('lets the owner upload a utility bill or type its total', async () => {
    setup('owner', '/bills?period=2026-07')
    const panel = await screen.findByRole('complementary', { name: 'Bill Jul 2026' })
    await userEvent.upload(within(panel).getByLabelText('Utility bill file'), new File(['%PDF'], 'hydro-july.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(h.uploads).toEqual(['2026-07:hydro-july.pdf']))
    await waitFor(() => expect(within(panel).getByTestId('utility-text')).toHaveTextContent('Reading the uploaded bill…'))
    h.utility = null
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Type the total' })).toBeInTheDocument(), { timeout: 4000 })
    await userEvent.click(within(panel).getByRole('button', { name: 'Type the total' }))
    await userEvent.type(within(panel).getByLabelText('Total on the utility bill'), '3,010.00')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.totals).toEqual([{ totalCents: 301_000 }]))
    await waitFor(() => expect(within(panel).getByTestId('utility-text')).toHaveTextContent('Utility bill $3,010 · our estimate $3,000 · difference -$10'))
  })

  it('shows spending for any range', async () => {
    setup('manager')
    const card = await screen.findByRole('region', { name: 'Spending for any date range' })
    const stats = await within(card).findByRole('list', { name: 'Range spending' })
    expect(within(stats).getAllByRole('listitem').map((c) => c.textContent)).toEqual([
      'Energy cost (TOU)$9001–24 Sep 2026',
      'Export credit-$8160 kWh sold',
      'Bought from grid4,200 kWh24 days',
      'Highest 15-min demand112 kW9 Sep 2026 15:15',
    ])
    fireEvent.change(within(card).getByLabelText('From'), { target: { value: '2026-09-10' } })
    await waitFor(() => expect(calls.ranges.at(-1)).toMatch(/from=2026-09-10/))
  })
})
