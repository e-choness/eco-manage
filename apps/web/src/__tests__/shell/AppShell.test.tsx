/**
 * P4-01: the App v2 shell. Rail by role, Inbox badge fed by the stream, theme saved on the user,
 * avatar menu with Profile and Sign out.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { InboxCounts, Role } from '@ecomanage/shared'
import { server } from '../setup'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell, RequireRole } from '@/shell/AppShell'

const BASE = 'http://localhost:3000'

const counts = (decide: number, alert: number, active = 0): InboxCounts => ({
  open: { decide, alert, active, all: decide + alert + active },
  closed: { decide: 0, alert: 0, active: 0, all: 0 },
})

interface Setup {
  role?: Role | null
  theme?: 'dark' | 'light' | null
  inbox?: InboxCounts
  streamed?: InboxCounts // sent as an `inbox` event after the snapshot
}

const calls: { profile: unknown[]; logout: number } = { profile: [], logout: 0 }

const setup = ({ role = 'manager', theme = null, inbox = counts(1, 2), streamed }: Setup = {}) => {
  server.use(
    http.post(`${BASE}/api/auth/refresh`, () =>
      HttpResponse.json({ accessToken: 't', user: { _id: 'u1', email: 'jamie@example.com', name: 'Jamie Reyes', theme } })
    ),
    http.get(`${BASE}/api/auth/me`, () =>
      HttpResponse.json({
        _id: 'u1',
        email: 'jamie@example.com',
        name: 'Jamie Reyes',
        theme,
        memberships: role ? [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] : [],
      })
    ),
    http.get(`${BASE}/api/inbox/counts`, () => HttpResponse.json(inbox)),
    http.put(`${BASE}/api/auth/profile`, async ({ request }) => {
      const body = await request.json()
      calls.profile.push(body)
      return HttpResponse.json({ _id: 'u1', email: 'jamie@example.com', ...(body as object) })
    }),
    http.post(`${BASE}/api/auth/logout`, () => {
      calls.logout++
      return HttpResponse.json({ success: true })
    }),
    http.get(`${BASE}/api/site/stream`, () => {
      const enc = new TextEncoder()
      const body = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`event: inbox\ndata: ${JSON.stringify({ counts: inbox, changed: [] })}\n\n`))
          if (streamed) {
            setTimeout(() => c.enqueue(enc.encode(`event: inbox\ndata: ${JSON.stringify({ counts: streamed, changed: [{ type: 'alert', id: 'a9' }] })}\n\n`)), 50)
          }
        },
      })
      return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } })
    })
  )
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/login" element={<p>Sign in page</p>} />
              <Route path="/dashboard" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                <Route index element={<p>Home page</p>} />
                <Route path="inbox" element={<p>Inbox page</p>} />
                <Route path="bills" element={<RequireRole roles={['owner', 'manager']}><p>Bills page</p></RequireRole>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  )

const rail = async () => within(await screen.findByRole('navigation', { name: 'Main' }))

beforeEach(() => {
  calls.profile = []
  calls.logout = 0
  document.documentElement.className = ''
})

describe('rail', () => {
  it('shows every screen to a manager, with the Inbox badge kept current by the stream', async () => {
    setup({ streamed: counts(2, 3) })
    renderAt('/dashboard')
    const nav = await rail()
    expect(nav.getAllByRole('link').map((a) => a.getAttribute('title'))).toEqual(['Home', 'Devices', 'History', 'Bills', 'Inbox', 'Settings'])
    expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByTestId('inbox-badge')).toHaveTextContent('3') // 1 decision + 2 alerts
    await waitFor(() => expect(screen.getByTestId('inbox-badge')).toHaveTextContent('5'))
    expect(nav.getByRole('link', { name: 'Inbox, 5 need you' })).toBeInTheDocument()
  })

  it('has no Bills for an installer, and sends them Home from its address', async () => {
    setup({ role: 'installer', inbox: counts(0, 0, 4) })
    renderAt('/dashboard/bills')
    expect(await screen.findByText('Home page')).toBeInTheDocument()
    const nav = await rail()
    expect(nav.queryByRole('link', { name: 'Bills' })).toBeNull()
    expect(screen.queryByTestId('inbox-badge')).toBeNull() // running commands don't need anyone
  })

  it('explains when the account has no site', async () => {
    setup({ role: null })
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'No site yet' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('theme', () => {
  it("applies the user's saved theme, and saves a switch on the user", async () => {
    setup({ theme: 'light' })
    renderAt('/dashboard')
    await rail()
    await waitFor(() => expect(document.documentElement).toHaveClass('light'))
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('ui-theme')).toBe('dark')
    await waitFor(() => expect(calls.profile).toEqual([{ theme: 'dark' }]))
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })
})

describe('avatar menu', () => {
  it('shows who is signed in and their role from the membership, and signs out', async () => {
    setup()
    renderAt('/dashboard')
    await rail()
    const avatar = screen.getByRole('button', { name: 'Account: Jamie Reyes, Manager' })
    expect(avatar).toHaveTextContent('JR')
    await userEvent.click(avatar)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Manager · Maple Grove School')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Sign in page')).toBeInTheDocument()
    expect(calls.logout).toBe(1)
  })

  it('edits the name in Profile', async () => {
    setup()
    renderAt('/dashboard')
    await rail()
    await userEvent.click(screen.getByRole('button', { name: 'Account: Jamie Reyes, Manager' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Profile' })
    expect(within(dialog).getByText('Manager at Maple Grove School. Your role is set by the site owner.')).toBeInTheDocument()
    const name = within(dialog).getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Jamie R.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.profile).toEqual([{ name: 'Jamie R.' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Account: Jamie R., Manager' })).toHaveTextContent('JR')
  })
})
