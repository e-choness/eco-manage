/**
 * P4-02: the invite link. New people create an account; people with one sign in with it; used,
 * expired and unknown links say why and point to sign in.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { InvitePreview } from '@ecomanage/shared'
import { server } from '../setup'
import { InviteAccept } from '@/pages/InviteAccept'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'

const BASE = 'http://localhost:3000'

const preview = (over: Partial<InvitePreview> = {}): InvitePreview => ({
  siteName: 'Maple Grove School',
  email: 'sam@example.com',
  role: 'installer',
  until: '2026-12-31T12:00:00.000Z',
  expiresAt: '2026-10-03T12:00:00.000Z',
  invitedBy: 'Priya Shah',
  hasAccount: false,
  ...over,
})

function Home() {
  const { user } = useAuth()
  return <p>Home page for {user?.name}</p>
}

const renderInvite = (token = 'tok123') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/invite/${token}`]}>
          <Routes>
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<p>Sign in page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )

const accepted: unknown[] = []
const serve = (p: InvitePreview | { status: number; message: string }, accept?: { status: number; message: string }) => {
  accepted.length = 0
  server.use(
    http.get(`${BASE}/api/invites/:token`, () =>
      'status' in p ? HttpResponse.json({ error: { code: p.status, message: p.message } }, { status: p.status }) : HttpResponse.json(p)
    ),
    http.post(`${BASE}/api/invites/:token/accept`, async ({ request, params }) => {
      accepted.push({ token: params.token, body: await request.json() })
      if (accept) return HttpResponse.json({ error: { code: accept.status, message: accept.message } }, { status: accept.status })
      return HttpResponse.json({ _id: 'u9', email: 'sam@example.com', name: 'Sam Lee', accessToken: 'a' })
    })
  )
}

describe('invite link', () => {
  it('creates the account and signs in to the site', async () => {
    serve(preview())
    renderInvite()
    expect(await screen.findByRole('heading', { name: 'Join Maple Grove School' })).toBeInTheDocument()
    expect(screen.getByText('Priya Shah invited sam@example.com as installer, with access until 31 December 2026.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.com')

    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name.')
    await userEvent.type(screen.getByLabelText('Your name'), 'Sam Lee')
    await userEvent.type(screen.getByLabelText('Choose a password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 8 characters for your password.')
    expect(accepted).toEqual([])

    await userEvent.type(screen.getByLabelText('Choose a password'), '-but-long')
    await userEvent.click(screen.getByRole('button', { name: 'Create account and join' }))
    expect(await screen.findByText('Home page for Sam Lee')).toBeInTheDocument()
    expect(accepted).toEqual([{ token: 'tok123', body: { name: 'Sam Lee', password: 'short-but-long' } }])
  })

  it('asks only for the password of an existing account', async () => {
    serve(preview({ hasAccount: true, until: null }), { status: 400, message: 'Password is incorrect for this account' })
    renderInvite()
    expect(await screen.findByText('You already have an EcoManage account. Enter its password to add this site.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your name')).toBeNull()
    await userEvent.type(screen.getByLabelText('Password'), 'guess')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in and join' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect for this account')
    expect(accepted).toEqual([{ token: 'tok123', body: { password: 'guess' } }])
  })

  it('explains a used or expired link and links to sign in', async () => {
    serve({ status: 410, message: 'This invite has already been used. Sign in instead.' })
    renderInvite()
    expect(await screen.findByRole('heading', { name: "This invite can't be used" })).toBeInTheDocument()
    expect(screen.getByText('This invite has already been used. Sign in instead.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Go to sign in' }))
    expect(await screen.findByText('Sign in page')).toBeInTheDocument()
  })

  it('switches to the explanation when the link is used up while the form is open', async () => {
    serve(preview({ hasAccount: true }), { status: 410, message: 'This invite has already been used. Sign in instead.' })
    renderInvite()
    await userEvent.type(await screen.findByLabelText('Password'), 'existing-pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in and join' }))
    const main = await screen.findByRole('main')
    expect(await within(main).findByRole('heading', { name: "This invite can't be used" })).toBeInTheDocument()
  })
})
