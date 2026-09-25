import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardHeader } from '@/components/DashboardHeader'
import { getAlerts } from '@/api/alerts'
import { notifyAlertsChanged } from '@/lib/alertEvents'

vi.mock('@/api/alerts', () => ({ getAlerts: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'demo@ecomanage.io', name: 'Demo' }, logout: vi.fn() }),
}))

const alerts = (unread: number) => ({
  alerts: Array.from({ length: unread }, (_, i) => ({ _id: String(i), read: false })),
})

describe('DashboardHeader alert polling (P0-06)', () => {
  const callTimes: number[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    callTimes.length = 0
    vi.mocked(getAlerts).mockImplementation(async () => {
      callTimes.push(Date.now())
      return alerts(2) as never
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const renderHeader = () =>
    render(
      <MemoryRouter>
        <DashboardHeader />
      </MemoryRouter>
    )

  it('never polls faster than every 30 s', async () => {
    renderHeader()
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))

    expect(callTimes.length).toBe(11) // on mount, then every 30 s for 5 minutes
    const gaps = callTimes.slice(1).map((t, i) => t - callTimes[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30_000)
  })

  it('shows the unread count', async () => {
    renderHeader()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('refreshes straight away when the alerts page changes an alert', async () => {
    renderHeader()
    await act(() => vi.advanceTimersByTimeAsync(0))
    vi.mocked(getAlerts).mockResolvedValue(alerts(1) as never)

    await act(async () => {
      notifyAlertsChanged()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('stops polling after unmount', async () => {
    const { unmount } = renderHeader()
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    const before = callTimes.length
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(callTimes.length).toBe(before)
  })
})
