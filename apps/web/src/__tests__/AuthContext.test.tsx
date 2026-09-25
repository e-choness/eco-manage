import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import api, { setAccessToken } from '@/api/api'
import { server } from './setup'

const BASE = 'http://localhost:3000'

function TestComponent() {
  const { isAuthenticated, isRestoring, user, login, register, logout } = useAuth()
  return (
    <div>
      <div data-testid="restoring">{isRestoring ? 'restoring' : 'ready'}</div>
      <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
      <div data-testid="email">{user?.email ?? ''}</div>
      <div data-testid="error" />
      <button
        onClick={() =>
          login('test@example.com', 'password').catch((e: Error) => {
            screen.getByTestId('error').textContent = e.message
          })
        }
      >
        login
      </button>
      <button
        onClick={() =>
          register('new@example.com', 'password', 'New User').catch((e: Error) => {
            screen.getByTestId('error').textContent = e.message
          })
        }
      >
        register
      </button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

const renderAuth = async () => {
  render(
    <AuthProvider>
      <TestComponent />
    </AuthProvider>
  )
  await waitFor(() => expect(screen.getByTestId('restoring')).toHaveTextContent('ready'))
}

const status = () => screen.getByTestId('auth-status')

describe('AuthContext', () => {
  beforeEach(() => {
    setAccessToken(null)
  })

  describe('session restore', () => {
    it('starts signed out when there is no refresh cookie', async () => {
      await renderAuth()
      expect(status()).toHaveTextContent('not-authenticated')
    })

    it('restores the session from the refresh cookie on load', async () => {
      server.use(
        http.post(`${BASE}/api/auth/refresh`, () =>
          HttpResponse.json({ accessToken: 'restored-token', user: { _id: 'u1', email: 'back@example.com' } })
        )
      )
      await renderAuth()
      expect(status()).toHaveTextContent('authenticated')
      expect(screen.getByTestId('email')).toHaveTextContent('back@example.com')
    })
  })

  describe('login', () => {
    it('signs in and keeps tokens out of web storage', async () => {
      await renderAuth()
      await userEvent.click(screen.getByText('login'))

      await waitFor(() => expect(status()).toHaveTextContent('authenticated'))
      expect(screen.getByTestId('email')).toHaveTextContent('test@example.com')
      expect(localStorage.getItem('accessToken')).toBeNull()
      expect(localStorage.getItem('refreshToken')).toBeNull()
      expect(localStorage.getItem('userData')).toBeNull()
    })

    it('sends the in-memory access token on later API calls', async () => {
      let authHeader: string | null = null
      server.use(
        http.get(`${BASE}/api/alerts`, ({ request }) => {
          authHeader = request.headers.get('authorization')
          return HttpResponse.json({ alerts: [] })
        })
      )
      await renderAuth()
      await userEvent.click(screen.getByText('login'))
      await waitFor(() => expect(status()).toHaveTextContent('authenticated'))

      await api.get('/api/alerts')
      expect(authHeader).toBe('Bearer mock-access-token')
    })

    it('stays signed out and reports the server message on failure', async () => {
      server.use(
        http.post(`${BASE}/api/auth/login`, () =>
          HttpResponse.json({ message: 'Email or password is incorrect' }, { status: 400 })
        )
      )
      await renderAuth()
      await userEvent.click(screen.getByText('login'))

      await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Email or password is incorrect'))
      expect(status()).toHaveTextContent('not-authenticated')
    })
  })

  describe('register', () => {
    it('creates the account and then signs in', async () => {
      await renderAuth()
      await userEvent.click(screen.getByText('register'))
      await waitFor(() => expect(status()).toHaveTextContent('authenticated'))
    })

    it('does not sign in when registration fails', async () => {
      let loginCalled = false
      server.use(
        http.post(`${BASE}/api/auth/register`, () =>
          HttpResponse.json({ message: 'User with this email already exists' }, { status: 400 })
        ),
        http.post(`${BASE}/api/auth/login`, () => {
          loginCalled = true
          return HttpResponse.json({})
        })
      )
      await renderAuth()
      await userEvent.click(screen.getByText('register'))

      await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('already exists'))
      expect(loginCalled).toBe(false)
      expect(status()).toHaveTextContent('not-authenticated')
    })
  })

  describe('logout', () => {
    it('calls the server and clears the session', async () => {
      let logoutCalled = false
      server.use(
        http.post(`${BASE}/api/auth/logout`, () => {
          logoutCalled = true
          return HttpResponse.json({ message: 'ok' })
        })
      )
      await renderAuth()
      await userEvent.click(screen.getByText('login'))
      await waitFor(() => expect(status()).toHaveTextContent('authenticated'))

      await userEvent.click(screen.getByText('logout'))
      await waitFor(() => expect(status()).toHaveTextContent('not-authenticated'))
      expect(logoutCalled).toBe(true)
    })
  })

  describe('expired access token', () => {
    it('refreshes once on 401 and retries the request', async () => {
      let calls = 0
      server.use(
        http.get(`${BASE}/api/alerts`, ({ request }) => {
          calls++
          return request.headers.get('authorization') === 'Bearer fresh-token'
            ? HttpResponse.json({ alerts: [] })
            : HttpResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
        }),
        http.post(`${BASE}/api/auth/refresh`, () =>
          HttpResponse.json({ accessToken: 'fresh-token', user: { _id: 'u1', email: 'a@b.c' } })
        )
      )
      setAccessToken('stale-token')

      const res = await api.get('/api/alerts')
      expect(res.status).toBe(200)
      expect(calls).toBe(2)
    })

    it('signs the user out when the refresh also fails', async () => {
      await renderAuth()
      await userEvent.click(screen.getByText('login'))
      await waitFor(() => expect(status()).toHaveTextContent('authenticated'))

      server.use(
        http.get(`${BASE}/api/alerts`, () => HttpResponse.json({ error: 'expired' }, { status: 401 }))
      )
      await expect(api.get('/api/alerts')).rejects.toBeDefined()
      await waitFor(() => expect(status()).toHaveTextContent('not-authenticated'))
    })
  })
})
