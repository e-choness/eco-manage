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
