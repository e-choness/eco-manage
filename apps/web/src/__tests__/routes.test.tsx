/**
 * P4-02: the app lives at the top level (/, /devices, /inbox …), matching the links in emails.
 * Addresses from before keep working.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { FromDashboard } from '@/App'

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/*" element={<FromDashboard />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )

describe('old /dashboard addresses', () => {
  it.each([
    ['/dashboard', '/'],
    ['/dashboard/', '/'],
    ['/dashboard/live', '/'],
    ['/dashboard/monitoring', '/devices'],
    ['/dashboard/alerts', '/inbox'],
    ['/dashboard/optimization', '/inbox'],
    ['/dashboard/settings', '/settings'],
    ['/dashboard/inbox?alert=a1', '/inbox?alert=a1'],
  ])('%s → %s', async (from, to) => {
    at(from)
    expect(await screen.findByTestId('where')).toHaveTextContent(to)
  })
})
