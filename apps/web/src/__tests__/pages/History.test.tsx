/**
 * P4-05: App v2 History. Presets and range, totals with a comparison, the four views (no cost for
 * installers), estimated bars, CSV export through the worker, and the report builder and list.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { HistoryBucket, HistorySeries, HistoryTotalsResponse, ReportView, Role } from '@ecomanage/shared'
import { server } from '../setup'
import { History } from '@/pages/History'
import { AuthProvider } from '@/contexts/AuthContext'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'
const downloads: string[] = []

beforeAll(() => {
  URL.createObjectURL = (() => 'blob:csv') as never
  URL.revokeObjectURL = (() => undefined) as never
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  }
})

const bucket = (start: string, over: Partial<HistoryBucket> = {}): HistoryBucket => ({
  start,
  pv: 24,
  used: 20,
  batt: 4.8,
  grid: 48,
  export: 4.8,
  bld: 28.8,
  hp: 9.6,
  ev: 4.8,
  peakKw: 40,
  costCents: 576,
  estimated: false,
  n: 96,
  ...over,
})

const series = (money: boolean): HistorySeries => ({
  from: '2026-09-22',
  to: '2026-09-24',
  days: 3,
  res: 'd',
  warnings: ['No data after today.'],
  dataStart: '2026-09-22',
  today: '2026-09-24',
  buckets: [
    bucket('2026-09-22T04:00:00.000Z'),
    bucket('2026-09-23T04:00:00.000Z', { peakKw: 88, estimated: true }),
    bucket('2026-09-24T04:00:00.000Z'),
  ].map((b) => (money ? b : { ...b, costCents: null })),
})

const totals = (money: boolean, compare: string): HistoryTotalsResponse => ({
  from: '2026-09-22',
  to: '2026-09-24',
  totals: { pvKwh: 72, gridKwh: 144, exportKwh: 14.4, peak: { kw: 88, at: '2026-09-23T18:15:00.000Z' }, costCents: money ? 172_800 : null, estimatedIntervals: 2, intervals: 288 },
  compare:
    compare === 'none'
      ? null
      : { from: '2026-09-19', to: '2026-09-21', totals: { pvKwh: 60, gridKwh: 160, exportKwh: 12, peak: { kw: 80, at: '2026-09-20T18:00:00.000Z' }, costCents: money ? 160_000 : null, estimatedIntervals: 0, intervals: 288 } },
})

const report: ReportView = {
  id: 'rep1',
  name: 'August energy',
  from: '2026-08-01',
  to: '2026-08-31',
  sections: ['summary'],
  format: 'pdf',
  schedule: 'monthly',
  recipients: ['priya@example.com'],
  notes: '',
  status: 'waiting',
  error: null,
  lastRunAt: null,
  lastRange: null,
  nextRunAt: '2026-10-01T11:00:00.000Z',
  createdBy: { id: 'u1', name: 'Priya Shah' },
  createdAt: '2026-09-01T12:00:00.000Z',
  canDelete: true,
}

const calls = { series: [] as string[], reports: [] as unknown[], exports: [] as unknown[] }

const setup = (role: Role) => {
  calls.series = []
  calls.reports = []
  calls.exports = []
  downloads.length = 0
  const money = role !== 'installer'
  let polls = 0
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'priya@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json({ site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 }, devices: [], flows: {}, battery: {}, demand: null, monthPeak: null, gateway: null, now: new Date().toISOString() })),
    http.get(`${BASE}/api/site/stream`, () => new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })),
    http.get(`${BASE}/api/history/series`, ({ request }) => {
      calls.series.push(new URL(request.url).search)
      return HttpResponse.json(series(money))
    }),
    http.get(`${BASE}/api/history/totals`, ({ request }) => HttpResponse.json(totals(money, new URL(request.url).searchParams.get('compare') ?? 'none'))),
    http.get(`${BASE}/api/reports`, () => HttpResponse.json({ items: [report] })),
    http.post(`${BASE}/api/reports`, async ({ request }) => {
      calls.reports.push(await request.json())
      return HttpResponse.json(report, { status: 201 })
    }),
    http.post(`${BASE}/api/exports`, async ({ request }) => {
      calls.exports.push(await request.json())
      return HttpResponse.json({ id: 'ex1', from: '2026-09-22', to: '2026-09-24', status: 'queued', rows: null, error: null, large: false, createdAt: '' }, { status: 202 })
    }),
    http.get(`${BASE}/api/exports/ex1`, () =>
      HttpResponse.json({ id: 'ex1', from: '2026-09-22', to: '2026-09-24', status: ++polls > 1 ? 'done' : 'queued', rows: 288, error: null, large: false, createdAt: '' })
    ),
    http.get(`${BASE}/api/exports/ex1/file`, () => new HttpResponse('local_start\n', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="energy-2026-09-22-to-2026-09-24.csv"' } }))
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/history']}>
          <SiteStreamProvider>
            <History />
          </SiteStreamProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

describe('History', () => {
  it('shows the range, totals, the chart with estimated bars, and warnings', async () => {
    setup('manager')
    await waitFor(() => expect(screen.getByTestId('range-text')).toHaveTextContent('22–24 Sep 2026 · 3 days · daily'))
    expect(screen.getByRole('note')).toHaveTextContent('No data after today.')
    const cards = within(screen.getByRole('list', { name: 'Totals' })).getAllByRole('listitem')
    expect(cards.map((c) => c.textContent)).toEqual([
      'Solar produced72.0 kWh',
      'Bought from grid144 kWh',
      'Sold to grid14.4 kWh',
      'Highest demand88 kWon 23 Sep',
      'Energy cost$1,728.00TOU energy only',
    ])
    const bars = screen.getAllByTestId('history-bar')
    expect(bars).toHaveLength(3)
    expect(bars[1].querySelector('[data-estimated]')).not.toBeNull()
    expect(bars[1]).toHaveAttribute('title', expect.stringMatching(/^Wed 23 Sep 2026 · Solar used on site 20\.0 kWh · Battery 4\.8 kWh · Grid import 48\.0 kWh · estimated$/))
    expect(screen.getByText('Estimated')).toBeInTheDocument()
  })

  it('compares with the previous period and switches views', async () => {
    setup('owner')
    await screen.findByTestId('range-text')
    await userEvent.selectOptions(screen.getByLabelText('Compare with'), 'prev')
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Totals' })).getAllByRole('listitem')[1]).toHaveTextContent('−10% vs 19–21 Sep 2026'))
    await userEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Demand' }))
    expect(screen.getByText('cap 120 kW')).toBeInTheDocument()
    expect(screen.getAllByTestId('history-bar')[1]).toHaveAttribute('title', expect.stringContaining('Highest 15-min demand 88 kW'))
  })

  it('asks for a preset range and a resolution', async () => {
    setup('manager')
    await screen.findByTestId('range-text')
    await userEvent.click(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: '7 days' }))
    await userEvent.selectOptions(screen.getByLabelText('Resolution'), 'h')
    await waitFor(() => expect(calls.series.at(-1)).toMatch(/res=h$/))
    const q = new URLSearchParams(calls.series.at(-1))
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBe(6 * 86_400_000)
  })

  it('shows installers no money', async () => {
    setup('installer')
    await screen.findByTestId('range-text')
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Totals' })).getAllByRole('listitem')).toHaveLength(4))
    expect(within(screen.getByRole('group', { name: 'View' })).queryByRole('button', { name: 'Energy cost' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    const form = screen.getByRole('form', { name: 'Create report' })
    expect(within(form).queryByRole('button', { name: 'Energy cost' })).toBeNull()
  })

  it('exports the range as CSV through the worker and downloads it', async () => {
    setup('manager')
    await screen.findByTestId('range-text')
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(downloads).toEqual(['energy-2026-09-22-to-2026-09-24.csv']), { timeout: 5000 })
    expect(calls.exports).toEqual([{ from: '2026-09-22', to: '2026-09-24' }])
  })

  it('builds a report for the range and lists reports', async () => {
    setup('owner')
    const list = await screen.findByRole('region', { name: 'Reports' })
    expect(await within(list).findByText('August energy')).toBeInTheDocument()
    // A monthly report covers the previous month and runs on the 1st at 07:00 site time.
    expect(list).toHaveTextContent('Covers the previous month')
    expect(list).toHaveTextContent(/First run 1 Oct, \d\d:00/)
    await screen.findByTestId('range-text')
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    const form = screen.getByRole('form', { name: 'Create report' })
    expect(within(form).getByLabelText('Period')).toHaveValue('22–24 Sep 2026')
    await userEvent.click(within(form).getByRole('button', { name: 'Alerts' }))
    await userEvent.selectOptions(within(form).getByLabelText('Schedule'), 'weekly')
    expect(within(form).getByLabelText('Period')).toHaveValue('Each run: the previous week (Mon–Sun)')
    expect(form).toHaveTextContent('Runs every Monday at 07:00 site time')
    await userEvent.click(within(form).getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(calls.reports).toHaveLength(1))
    expect(calls.reports[0]).toEqual({
      name: 'Energy report · 22–24 Sep 2026',
      from: '2026-09-22',
      to: '2026-09-24',
      sections: ['summary', 'sources', 'demand', 'cost', 'decisions', 'alerts'],
      format: 'pdf',
      schedule: 'weekly',
      recipients: ['priya@example.com'],
      notes: '',
    })
  })
})
