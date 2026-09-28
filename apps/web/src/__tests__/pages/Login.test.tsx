/**
 * P4-02: App v2 Login. Signs in through the real AuthContext and API client (MSW), lands on Home
 * or the page the person was sent away from, and shows the server's message on failure.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../setup'
import { Login } from '@/pages/Login'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/components/ui/theme-provider'

const BASE = 'http://localhost:3000'

const renderLogin = (entry: string | { pathname: string; state: unknown } = '/login') =>
  render(
    <ThemeProvider defaultTheme="dark" storageKey="t">
      <AuthProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<p>Home page</p>} />
            <Route path="/inbox" element={<p>Inbox page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  )

const fill = async (email: string, password: string) => {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email)
  if (password) await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Login', () => {
  it('shows the site picture with sample flows beside the form, hidden from screen readers', () => {
    const { container } = renderLogin()
    const picture = container.querySelector('[aria-hidden="true"]')
    expect(picture?.querySelector('caption')?.textContent).toBe('Power flows now')
    // Sources and loads balance at the switchboard: solar + battery + grid = EVs + heat pump + building.
    const kw = Object.fromEntries([...picture!.querySelectorAll('tbody tr')].map((r) => [r.querySelector('th')!.textContent, Number(r.querySelector('td')!.textContent)]))
    expect(kw.Solar + kw.Battery + kw.Grid).toBeCloseTo(kw['EV chargers'] + kw['Heat pump'] + kw.Building, 0)
  })

  it('shows the App v2 sign-in panel', async () => {
    renderLogin()
    expect(await screen.findByRole('heading', { name: 'Sign in to your site' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByText('Demo account: demo@ecomanage.io · Demo1234!')).toBeInTheDocument()
    expect(screen.getByText(/invite-only/)).toBeInTheDocument()
    expect(screen.queryByText(/sign up/i)).toBeNull()
  })

  it('signs in and goes Home', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/api/auth/login`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ _id: 'u1', email: 'jamie@example.com', accessToken: 'a' })
      })
    )
    renderLogin()
    await screen.findByLabelText('Email')
    await fill(' jamie@example.com ', 'Demo1234!')
    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(body).toEqual({ email: 'jamie@example.com', password: 'Demo1234!' })
  })

  it('returns to the page the person was sent away from', async () => {
    renderLogin({ pathname: '/login', state: { from: { pathname: '/inbox', search: '' } } })
    await screen.findByLabelText('Email')
    await fill('jamie@example.com', 'Demo1234!')
    expect(await screen.findByText('Inbox page')).toBeInTheDocument()
  })

  it("shows the server's message and stays signed out", async () => {
    server.use(http.post(`${BASE}/api/auth/login`, () => HttpResponse.json({ message: 'Email or password is incorrect' }, { status: 400 })))
    renderLogin()
    await screen.findByLabelText('Email')
    await fill('jamie@example.com', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.queryByText('Home page')).toBeNull()
  })

  it('asks for both fields before calling the server', async () => {
    let called = false
    server.use(
      http.post(`${BASE}/api/auth/login`, () => {
        called = true
        return HttpResponse.json({})
      })
    )
    renderLogin()
    await screen.findByLabelText('Email')
    await fill('jamie@example.com', '')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email and password.')
    await waitFor(() => expect(called).toBe(false))
  })
})
