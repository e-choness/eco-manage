/**
 * P4-07: App v2 Inbox. The list with open/closed and type filters and paging; the decision detail
 * with the slider re-checking (debounced 300 ms), approve and decline with a reason; the alert
 * detail with its actions and close form; the command detail with cancel early; email links.
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import type { AlertDetail, CommandView, DeviceDetail, InboxCounts, InboxItem, RecommendationDetail, Role } from '@ecomanage/shared'
import { server } from '../setup'
import { Inbox } from '@/pages/Inbox'
import { AuthProvider } from '@/contexts/AuthContext'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'
const now = Date.now()
const iso = (ms: number) => new Date(now + ms).toISOString()
const MIN = 60_000

const item = (type: InboxItem['type'], id: string, title: string, over: Partial<InboxItem> = {}): InboxItem => ({
  key: `${type}:${id}`,
  type,
  id,
  kind: type === 'decide' ? 'Decision' : type === 'alert' ? 'Alert' : 'Active',
  title,
  deviceId: 'bat',
  deviceName: 'Battery',
  sub: '',
  status: 'open',
  at: iso(-5 * MIN),
  due: null,
  ...over,
})

const page1: InboxItem[] = [
  item('decide', 'r1', 'Discharge battery at 30 kW, 14:00–17:00', { sub: 'Battery · expected saving $266', due: iso(65 * MIN) }),
  item('alert', 'a1', 'Device not reporting', { sub: 'EV charger 3 · open', deviceId: 'ev3', deviceName: 'EV charger 3' }),
  item('active', 'c1', 'Charge battery', { sub: 'Battery · running until 17:00' }),
]
const page2: InboxItem[] = [item('alert', 'a0', 'Gateway holding old readings', { at: iso(-3 * 86_400_000) })]
const counts: InboxCounts = { open: { decide: 1, alert: 2, active: 1, all: 4 }, closed: { decide: 2, alert: 5, active: 3, all: 10 } }

const rec = (over: Partial<RecommendationDetail> = {}): RecommendationDetail => ({
  id: 'r1',
  ruleId: 'peak-shaving',
  ruleTitle: 'Peak shaving',
  deviceId: 'bat',
  deviceName: 'Battery',
  action: 'force_discharge',
  params: { kw: 30, until: iso(4 * 3_600_000) },
  title: 'Discharge battery at 30 kW, 14:00–17:00',
  window: { start: iso(80 * MIN), end: iso(260 * MIN) },
  expectedSavingCents: 26_600,
  status: 'proposed',
  proposedAt: iso(-5 * MIN),
  expiresAt: iso(65 * MIN),
  inputs: [{ label: 'Forecast peak', value: '131 kW at 15:15' }],
  checks: [
    { text: 'Battery stays above the 20% reserve', pass: true },
    { text: 'Under the 60 kW inverter limit', pass: true },
  ],
  calc: '21 kW × $14.00/kW = $294 less $28 charging cost',
  decidedBy: null,
  decidedAt: null,
  declineReason: null,
  commandId: null,
  payload: { deviceId: 'bat', action: 'force_discharge', params: { kw: 30 }, expiresAt: iso(95 * MIN), revertAt: iso(260 * MIN) },
  canApprove: true,
  ...over,
})

const batteryDevice = {
  id: 'bat',
  profile: {
    actions: [{ id: 'force_discharge', description: 'Discharge at a fixed power', params: { kw: { type: 'number', unit: 'kW', min: 0, max: 60 }, until: { type: 'time' } }, maxDurationMin: 360 }],
  },
} as unknown as DeviceDetail

const alert = (id: string, over: Partial<AlertDetail> = {}): AlertDetail => ({
  id,
  siteId: 's1',
  deviceId: 'ev3',
  ruleId: 'device-silent',
  severity: 'warning',
  title: 'Device not reporting',
  detail: 'EV charger 3: no data for 7 min',
  state: 'open',
  condition: 'active',
  openedAt: iso(-20 * MIN),
  lastSeenAt: iso(-MIN),
  count: 1,
  resolvedAt: null,
  deviceName: 'EV charger 3',
  ackBy: null,
  ackAt: null,
  snoozedUntil: null,
  resolution: null,
  fixes: [{ id: 'soft-reset', label: 'Remote restart (OCPP soft reset)' }],
  actions: { ack: true, snooze: true, fix: true, resolve: false, falseAlarm: true },
  ...over,
})

const command: CommandView = {
  id: 'c1',
  deviceId: 'bat',
  deviceName: 'Battery',
  action: 'force_charge',
  params: { kw: 30 },
  status: 'verified',
  sendAt: iso(-60 * MIN),
  sentAt: iso(-60 * MIN),
  ackedAt: iso(-60 * MIN),
  verifiedAt: iso(-58 * MIN),
  failedAt: null,
  error: null,
  expiresAt: iso(-45 * MIN),
  revertAt: iso(120 * MIN),
  revertedAt: null,
  cancelledAt: null,
  recommendation: { id: 'r0', title: 'Charge battery' },
  revert: null,
}

const calls = { checks: [] as unknown[], approvals: [] as unknown[], declines: [] as unknown[], alertActions: [] as string[], resolves: [] as unknown[], cancels: [] as string[] }

const setup = (role: Role, path = '/inbox', over: { rec?: RecommendationDetail; failingCheck?: boolean } = {}) => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = []
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'u@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json({ site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 }, devices: [], flows: {}, battery: {}, demand: null, monthPeak: null, gateway: null, now: '' })),
    http.get(`${BASE}/api/site/stream`, () => new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })),
    http.get(`${BASE}/api/inbox/counts`, () => HttpResponse.json(counts)),
    http.get(`${BASE}/api/inbox`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      return HttpResponse.json(cursor ? { items: page2, counts, nextCursor: null } : { items: page1, counts, nextCursor: 'next' })
    }),
    http.get(`${BASE}/api/recommendations/r1`, () => HttpResponse.json(over.rec ?? rec({ canApprove: role !== 'installer' }))),
    http.get(`${BASE}/api/devices/bat`, () => HttpResponse.json(batteryDevice)),
    http.post(`${BASE}/api/recommendations/r1/check`, async ({ request }) => {
      const body = (await request.json()) as { params: { kw: number } }
      calls.checks.push(body)
      const ok = !(over.failingCheck && body.params.kw > 50)
      return HttpResponse.json({ checks: [{ text: 'Under the 60 kW inverter limit', pass: ok }], expectedSavingCents: body.params.kw * 1000, calc: `${body.params.kw} kW calc`, allPass: ok })
    }),
    http.post(`${BASE}/api/recommendations/r1/approve`, async ({ request }) => {
      calls.approvals.push(await request.json())
      return HttpResponse.json({ commandId: 'c9' })
    }),
    http.post(`${BASE}/api/recommendations/r1/decline`, async ({ request }) => {
      calls.declines.push(await request.json())
      return HttpResponse.json({})
    }),
    http.get(`${BASE}/api/alerts/:id`, ({ params }) => HttpResponse.json(params.id === 'a2' ? alert('a2', { title: 'Command failed', ruleId: 'command-failed', condition: 'cleared', actions: { ack: true, snooze: false, fix: false, resolve: true, falseAlarm: false } }) : alert(String(params.id)))),
    http.post(`${BASE}/api/alerts/:id/:action`, async ({ params, request }) => {
      calls.alertActions.push(`${params.id}:${params.action}`)
      if (params.action === 'resolve') calls.resolves.push(await request.json())
      return HttpResponse.json({})
    }),
    http.get(`${BASE}/api/commands/c1`, () => HttpResponse.json(command)),
    http.post(`${BASE}/api/commands/c1/cancel`, () => {
      calls.cancels.push('c1')
      return HttpResponse.json({ ...command, status: 'verified', revert: { id: 'c2', action: 'force_charge', status: 'created' } })
    })
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <SiteStreamProvider>
            <Inbox />
          </SiteStreamProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

const detail = () => screen.getByRole('complementary', { name: 'Selected item' })

describe('Inbox list', () => {
  it('shows open items with counts and pages further', async () => {
    setup('manager')
    const list = await screen.findByRole('list', { name: 'Inbox items' })
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(3))
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^DecisionDischarge battery at 30 kW, 14:00–17:00Battery · expected saving \$266by \d\d:\d\d$/),
      expect.stringMatching(/^AlertDevice not reportingEV charger 3 · open\d\d:\d\d$/),
      expect.stringMatching(/^ActiveCharge batteryBattery · running until 17:00\d\d:\d\d$/),
    ])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open (4)' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Closed (10)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(4))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})

describe('decision', () => {
  it('explains the proposal and re-checks once after the slider settles', async () => {
    setup('manager')
    await waitFor(() => expect(within(detail()).getByRole('heading', { name: 'Discharge battery at 30 kW, 14:00–17:00' })).toBeInTheDocument())
    const d = detail()
    expect(within(d).getByTestId('detail-status')).toHaveTextContent(/^Waiting for approval · expires \d\d:\d\d$/)
    expect(within(d).getByRole('region', { name: 'Why it was suggested' })).toHaveTextContent('Forecast peak131 kW at 15:15')
    expect(within(d).getByRole('region', { name: 'Checks against your limits' })).toHaveTextContent('PassBattery stays above the 20% reserve')
    expect(within(d).getByRole('region', { name: 'Expected saving $266' })).toHaveTextContent('21 kW × $14.00/kW')
    const slider = await within(d).findByRole('slider')
    fireEvent.change(slider, { target: { value: '35' } })
    fireEvent.change(slider, { target: { value: '40' } })
    await waitFor(() => expect(calls.checks).toEqual([{ params: { kw: 40, until: expect.any(String) } }]))
    expect(await within(d).findByRole('region', { name: 'Expected saving $400' })).toHaveTextContent('40 kW calc')
    await userEvent.click(within(d).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.approvals).toEqual([{ params: { kw: 40, until: expect.any(String) } }]))
  })

  it('turns Approve off while a limit check fails', async () => {
    setup('owner', '/inbox', { failingCheck: true })
    const slider = await within(await screen.findByRole('complementary', { name: 'Selected item' })).findByRole('slider')
    fireEvent.change(slider, { target: { value: '55' } })
    await waitFor(() => expect(within(detail()).getByRole('region', { name: 'Checks against your limits' })).toHaveTextContent('Fails'))
    expect(within(detail()).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(detail()).toHaveTextContent('Approve is off because a limit check fails.')
  })

  it('declines with a reason', async () => {
    setup('manager')
    await within(await screen.findByRole('complementary', { name: 'Selected item' })).findByRole('slider')
    await userEvent.selectOptions(within(detail()).getByLabelText('Reason if you decline'), 'Doing it manually')
    await userEvent.click(within(detail()).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.declines).toEqual([{ reason: 'Doing it manually' }]))
  })

  it('shows installers the proposal without the buttons', async () => {
    setup('installer')
    await waitFor(() => expect(detail()).toHaveTextContent('Installers can see proposals but can’t approve them.'))
    expect(within(detail()).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(detail()).queryByRole('slider')).toBeNull()
  })

  it('shows the outcome of a declined decision', async () => {
    setup('manager', '/inbox?item=decide:r1', { rec: rec({ status: 'declined', declineReason: 'Bad timing for the building', decidedBy: { id: 'u2', name: 'Priya Shah' }, decidedAt: iso(-MIN) }) })
    await waitFor(() => expect(within(detail()).getByRole('region', { name: 'Outcome' })).toHaveTextContent('ReasonBad timing for the building'))
    expect(within(detail()).getByTestId('detail-status')).toHaveTextContent('Declined by Priya Shah')
    expect(within(detail()).queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})

describe('alert', () => {
  it('acknowledges, pauses emails, runs a fix and closes as a false alarm', async () => {
    setup('installer', '/inbox?item=alert:a1')
    const d = await screen.findByRole('complementary', { name: 'Selected item' })
    await waitFor(() => expect(within(d).getByRole('region', { name: 'What triggered it' })).toHaveTextContent('Conditionstill true'))
    await userEvent.click(within(d).getByRole('button', { name: 'Acknowledge' }))
    await userEvent.click(within(d).getByRole('button', { name: 'Pause emails 24 h' }))
    await userEvent.click(within(d).getByRole('button', { name: 'Remote restart (OCPP soft reset)' }))
    await userEvent.click(within(d).getByRole('button', { name: 'Close as false alarm' }))
    const form = within(d).getByRole('form', { name: 'Close alert' })
    expect(within(form).getByLabelText('Cause')).toHaveDisplayValue('False alarm')
    expect(form).toHaveTextContent('Mutes this check for this device for 7 days')
    await userEvent.type(within(form).getByLabelText('Note'), 'Cable was unplugged for cleaning')
    await userEvent.click(within(form).getByRole('button', { name: 'Close alert' }))
    await waitFor(() => expect(calls.resolves).toEqual([{ cause: 'False alarm', note: 'Cable was unplugged for cleaning' }]))
    expect(calls.alertActions).toEqual(['a1:ack', 'a1:snooze', 'a1:fix', 'a1:resolve'])
  })

  it('opens from an email link even when it is not in the list, and resolves a cleared one with a cause', async () => {
    setup('owner', '/inbox?alert=a2')
    await waitFor(() => expect(within(detail()).getByRole('heading', { name: 'Command failed' })).toBeInTheDocument())
    await userEvent.click(within(detail()).getByRole('button', { name: 'Resolve' }))
    const form = within(detail()).getByRole('form', { name: 'Close alert' })
    expect(within(form).queryByRole('option', { name: 'False alarm' })).toBeNull()
    await userEvent.selectOptions(within(form).getByLabelText('Cause'), 'Fixed on site')
    await userEvent.click(within(form).getByRole('button', { name: 'Close alert' }))
    await waitFor(() => expect(calls.resolves).toEqual([{ cause: 'Fixed on site', note: '' }]))
  })
})

describe('command', () => {
  it('shows a running command with its timeline, and cancels it early', async () => {
    setup('manager', '/inbox?item=active:c1')
    await waitFor(() => expect(within(detail()).getByTestId('detail-status')).toHaveTextContent(/^Running until \d\d:\d\d$/))
    const steps = within(within(detail()).getByRole('region', { name: 'Timeline' })).getAllByRole('listitem')
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'now', 'next'])
    await userEvent.click(within(detail()).getByRole('button', { name: 'Cancel early' }))
    await waitFor(() => expect(calls.cancels).toEqual(['c1']))
  })

  it("doesn't offer cancel to installers", async () => {
    setup('installer', '/inbox?item=active:c1')
    await waitFor(() => expect(within(detail()).getByTestId('detail-status')).toBeInTheDocument())
    expect(within(detail()).queryByRole('button', { name: 'Cancel early' })).toBeNull()
  })
})
