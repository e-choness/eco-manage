/**
 * P0-05: web side of the spec §9 bugs. Each test failed before the fix.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../setup'
import { Dashboard } from '@/pages/Dashboard'
import { Optimization } from '@/pages/Optimization'
import { Analytics } from '@/pages/Analytics'

// A stable toast: the pages list it as an effect dependency.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }))

const BASE = 'http://localhost:3000'

const overview = {
  totalProduction: 213.5,
  currentPower: 4,
  dailyProduction: 7.12,
  monthlyProduction: 163.5,
  todayProduction: 28,
  productionChangePct: 60,
  systemStatus: 'optimal',
  weatherCondition: 'sunny',
  temperature: 22,
  savings: 25.62,
  carbonOffsetKg: 106.75,
}

const flow = { solar: 3, wind: 1, battery: 0, consumption: 5, grid: 1, timestamp: '2026-09-24T12:00:00.000Z' }

const serveDashboard = (overrides: Partial<typeof overview> = {}, flowOverrides: Partial<typeof flow> = {}) =>
  server.use(
    http.get(`${BASE}/api/dashboard/overview`, () => HttpResponse.json({ ...overview, ...overrides })),
    http.get(`${BASE}/api/dashboard/energy-flow`, () => HttpResponse.json({ ...flow, ...flowOverrides })),
    http.get(`${BASE}/api/devices`, () => HttpResponse.json({ devices: [] }))
  )

const renderPage = (page: JSX.Element) => render(<MemoryRouter>{page}</MemoryRouter>)

describe('Dashboard', () => {
  it('shows carbon offset in kg over 30 days, not tons today', async () => {
    serveDashboard()
    renderPage(<Dashboard />)
    const card = (await screen.findByText('Carbon Offset')).closest('.rounded-lg') as HTMLElement
    expect(within(card).getByText('106.75 kg')).toBeInTheDocument()
    expect(within(card).getByText(/last 30 days/i)).toBeInTheDocument()
    expect(screen.queryByText(/tons/)).not.toBeInTheDocument()
  })

  it('shows the real change against yesterday instead of a fixed +12%', async () => {
    serveDashboard({ productionChangePct: -8.5 })
    renderPage(<Dashboard />)
    expect(await screen.findByText('-8.5% vs same time yesterday')).toBeInTheDocument()
    expect(screen.queryByText(/\+12%/)).not.toBeInTheDocument()
  })

  it('says so when there is no baseline to compare with', async () => {
    serveDashboard({ productionChangePct: null as unknown as number })
    renderPage(<Dashboard />)
    expect(await screen.findByText('No data from yesterday to compare')).toBeInTheDocument()
  })

  it('colours the system badge from the status string', async () => {
    serveDashboard({ systemStatus: 'warning' })
    renderPage(<Dashboard />)
    const badge = await screen.findByText('System warning')
    expect(badge.className).toContain('bg-yellow-500')
  })

  it('labels the grid flow as import or export', async () => {
    serveDashboard({}, { grid: -2.5 })
    renderPage(<Dashboard />)
    expect(await screen.findByText('Grid export')).toBeInTheDocument()
    expect(screen.getByText('2.5 kW')).toBeInTheDocument()
  })
})

describe('Optimization', () => {
  it('saves a dismissal on the server', async () => {
    let dismissed: unknown = null
    server.use(
      http.get(`${BASE}/api/optimization/recommendations`, () =>
        HttpResponse.json({
          recommendations: [
            {
              _id: 'rec-1',
              title: 'Shift laundry',
              description: 'Run it at noon',
              priority: 'low',
              estimatedSavings: 5,
              difficulty: 'easy',
              category: 'load',
              status: 'pending',
            },
          ],
        })
      ),
      http.post(`${BASE}/api/optimization/dismiss`, async ({ request }) => {
        dismissed = await request.json()
        return HttpResponse.json({ _id: 'rec-1', status: 'dismissed' })
      })
    )
    renderPage(<Optimization />)
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(dismissed).toEqual({ recommendationId: 'rec-1' }))
    await waitFor(() => expect(screen.queryByText('Shift laundry')).not.toBeInTheDocument())
  })
})

describe('Analytics', () => {
  it('no longer offers to send data to an LLM', async () => {
    let insightCalled = false
    server.use(
      http.get(`${BASE}/api/analytics/production`, () =>
        HttpResponse.json({
          period: 'month',
          data: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${10 + i}`, solar: 5, wind: 2, total: 7 })),
        })
      ),
      http.get(`${BASE}/api/analytics/consumption`, () =>
        HttpResponse.json({
          period: 'month',
          data: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${10 + i}`, consumption: 6 })),
        })
      ),
      http.post(`${BASE}/api/analytics/insight`, () => {
        insightCalled = true
        return HttpResponse.json({ insight: 'x' })
      })
    )
    renderPage(<Analytics />)
    await screen.findAllByText(/production/i)
    await screen.findByText(/than the previous period/)
    expect(screen.queryByRole('button', { name: /detailed insight/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/AI Insight/)).not.toBeInTheDocument()
    expect(insightCalled).toBe(false)
  })
})
