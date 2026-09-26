/**
 * P0-05: web side of the spec §9 bugs still in use. The Dashboard and Analytics tests left with
 * those pages in P1-10.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../setup'
import { Optimization } from '@/pages/Optimization'

// A stable toast: the pages list it as an effect dependency.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }))

const BASE = 'http://localhost:3000'

const renderPage = (page: JSX.Element) => render(<MemoryRouter>{page}</MemoryRouter>)

describe('Optimization', () => {
  it('saves a dismissal on the server as a decline with a reason', async () => {
    let dismissed: unknown = null
    const view = {
      id: 'rec-1',
      ruleId: 'peak-shaving',
      ruleTitle: 'Peak shaving',
      deviceId: 'bat',
      deviceName: 'Battery',
      action: 'force_discharge',
      params: { kw: 25 },
      title: 'Discharge battery at 25 kW, 14:00–17:00',
      window: { start: '2026-09-24T18:00:00.000Z', end: '2026-09-24T21:00:00.000Z' },
      expectedSavingCents: 26_600,
      status: 'proposed',
      proposedAt: '2026-09-24T16:30:00.000Z',
      expiresAt: '2026-09-24T17:45:00.000Z',
    }
    server.use(
      http.get(`${BASE}/api/recommendations`, () => HttpResponse.json({ items: [view], counts: { open: 1, closed: 0 } })),
      http.post(`${BASE}/api/recommendations/rec-1/decline`, async ({ request }) => {
        dismissed = await request.json()
        return HttpResponse.json({ ...view, status: 'declined' })
      })
    )
    renderPage(<Optimization />)
    expect(await screen.findByText('$266')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(dismissed).toEqual({ reason: 'Dismissed on the Optimization page' }))
    await waitFor(() => expect(screen.queryByText('Discharge battery at 25 kW, 14:00–17:00')).not.toBeInTheDocument())
  })
})
