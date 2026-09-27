/**
 * P4-08: App v2 Settings. Drafts kept across tabs and saved or discarded from the sticky bar (each
 * section to its own endpoint), read-only views by role, the tariff strip and its checks (live and
 * from the server's 422), rules, calendar, site model, people and notifications.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { DEFAULT_SITE_MODEL, TARIFF_TEMPLATES, type PeopleResponse, type Role, type RulesResponse, type SiteSettings } from '@ecomanage/shared'
import { server } from '../setup'
import { Settings } from '@/pages/Settings'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { SiteStreamProvider } from '@/shell/SiteStreamProvider'

const BASE = 'http://localhost:3000'

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
})

const site: SiteSettings = {
  id: 's1',
  name: 'Maple Grove School',
  address: '12 Maple Ave',
  tz: 'America/Toronto',
  lat: 43.7,
  lon: -79.4,
  currency: 'CAD',
  billDay: 1,
  demandCapKw: 120,
  pvArrays: [{ id: 'a1', name: 'Roof north', inverterId: 'invA', kwp: 50, tiltDeg: 10, azimuthDeg: 180 }],
  battery: { deviceId: 'bat', usableKwh: 200, maxKw: 60, floorPct: 10 },
}

const rules: RulesResponse = {
  approval: { who: 'owner-or-manager', expireMin: 15, email: 'approvers' },
  rules: [
    { id: 'peak-shaving', title: 'Peak shaving', device: 'battery', on: true, params: { socSchoolPct: 30, socOtherPct: 15, maxKw: 60, marginKw: 10 }, defaults: { on: true, params: {} }, declines30d: { count: 2, reasons: [{ reason: 'Bad timing for the building', count: 2 }] } },
    { id: 'ev-offpeak', title: 'EV off-peak', device: 'ev', on: true, params: { bufferPct: 20, fleetOnly: true }, defaults: { on: true, params: {} }, declines30d: { count: 0, reasons: [] } },
  ],
}

const people: PeopleResponse = {
  members: [
    { id: 'm1', userId: 'u1', name: 'Priya Shah', email: 'priya@example.com', role: 'owner', until: null, you: true },
    { id: 'm3', userId: 'u3', name: 'Northside Solar', email: 'north@example.com', role: 'installer', until: '2026-12-31', you: false },
  ],
  invites: [{ id: 'i1', email: 'sam@example.com', role: 'manager', until: null, expiresAt: '2026-10-03T12:00:00.000Z', invitedBy: 'Priya Shah' }],
}

const tou = { ...TARIFF_TEMPLATES[0].tariff, validFrom: '2024-03-14', version: 2, createdAt: null }
const calls: Record<string, unknown[]> = {}
const record = (key: string, body: unknown) => (calls[key] ??= []).push(body)

const upload = (over: object) => ({ originalName: 'School.glb', format: 'glb', bytes: 5_200_000, reason: null, glbUrl: null, thumbUrl: null, glbBytes: null, tris: null, trisIn: null, bbox: null, scale: null, inUse: false, createdBy: { id: 'u2', name: 'Northside Solar' }, createdAt: '2026-09-27T12:00:00.000Z', processedAt: null, ...over })
const UPLOADS = [
  upload({ id: 'up1', status: 'ready', glbUrl: '/cdn/models/a/model.glb', thumbUrl: '/cdn/models/a/thumb.png', glbBytes: 812_000, tris: 180_000, trisIn: 420_000, scale: 0.01 }),
  upload({ id: 'up2', originalName: 'Tiny.fbx', format: 'fbx', status: 'rejected', reason: 'The model is only 1.0 cm across. Export it in metres.' }),
]
const UPLOADED_MODEL = { ...DEFAULT_SITE_MODEL, version: 3, source: 'upload', upload: { uploadId: 'up1', glbUrl: '/cdn/models/a/model.glb', thumbUrl: null, originalName: 'School.glb', tris: 180_000, bytes: 812_000, bbox: { min: [-20, 0, -12], max: [20, 9, 12] }, scale: 0.01 } }

const setup = (role: Role, tab = 'site', over: { tariff422?: boolean; uploadedModel?: boolean } = {}) => {
  for (const k of Object.keys(calls)) delete calls[k]
  server.use(
    http.get(`${BASE}/api/auth/me`, () => HttpResponse.json({ _id: 'u1', email: 'priya@example.com', memberships: [{ siteId: 's1', siteName: 'Maple Grove School', role, until: null }] })),
    http.get(`${BASE}/api/site/snapshot`, () => HttpResponse.json({ site: { id: 's1', name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD', demandCapKw: 120, billDay: 1 }, devices: [], flows: { pv: 0, battery: 0, grid: 0, ev: 0, heatpump: 0, building: 0, stale: [] }, battery: { socPct: 50, reservePct: 20, usableKwh: 200, pKw: 0, minutesLeft: null }, demand: null, monthPeak: null, gateway: null, now: '' })),
    http.get(`${BASE}/api/site/stream`, () => new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })),
    http.get(`${BASE}/api/site`, () => HttpResponse.json(site)),
    http.patch(`${BASE}/api/site`, async ({ request }) => (record('site', await request.json()), HttpResponse.json(site))),
    http.put(`${BASE}/api/site/pv-arrays`, async ({ request }) => (record('arrays', await request.json()), HttpResponse.json(site))),
    http.get(`${BASE}/api/site/gateway`, () => HttpResponse.json({ id: 'gw-maple-01', online: true, fw: '1.4.2', buffered: 0, bufferDays: 7, batteryFloorPct: 10, configPending: false })),
    http.get(`${BASE}/api/devices`, () => HttpResponse.json({ items: [{ id: 'invA', type: 'pv', name: 'Inverter A' }, { id: 'invB', type: 'pv', name: 'Inverter B' }] })),
    http.get(`${BASE}/api/tariffs`, () => HttpResponse.json({ items: [tou], current: 2 })),
    http.get(`${BASE}/api/tariffs/templates`, () => HttpResponse.json({ items: TARIFF_TEMPLATES })),
    http.post(`${BASE}/api/tariffs`, async ({ request }) => {
      record('tariff', await request.json())
      if (over.tariff422)
        return HttpResponse.json({ error: { code: 422, message: 'The tariff has gaps or overlaps', details: { issues: [{ kind: 'valid-from', message: 'Valid from must be on or after 2026-09-01' }] } } }, { status: 422 })
      return HttpResponse.json({ ...tou, version: 3, validFrom: '2026-09-27' }, { status: 201 })
    }),
    http.get(`${BASE}/api/rules`, () => HttpResponse.json(rules)),
    http.patch(`${BASE}/api/rules/:id`, async ({ request, params }) => (record(`rule:${params.id}`, await request.json()), HttpResponse.json(rules))),
    http.get(`${BASE}/api/calendar`, () => HttpResponse.json({ terms: [{ name: 'Fall term', start: '2026-09-02', end: '2026-12-18' }], daysOff: [], open: '07:30', close: '17:30', weekends: 'closed', updatedAt: null })),
    http.put(`${BASE}/api/calendar`, async ({ request }) => (record('calendar', await request.json()), HttpResponse.json({}))),
    http.get(`${BASE}/api/site/model`, () => HttpResponse.json(over.uploadedModel ? UPLOADED_MODEL : DEFAULT_SITE_MODEL)),
    http.get(`${BASE}/api/site/model/uploads`, () => HttpResponse.json({ items: UPLOADS })),
    http.post(`${BASE}/api/site/model/uploads/:id/use`, ({ params }) => (record('use', params.id), HttpResponse.json(UPLOADED_MODEL))),
    http.post(`${BASE}/api/site/model/uploads`, () => (record('upload', true), HttpResponse.json(UPLOADS[0], { status: 202 }))),
    http.put(`${BASE}/api/site/model`, async ({ request }) => (record('model', await request.json()), HttpResponse.json(DEFAULT_SITE_MODEL))),
    http.get(`${BASE}/api/me/notifications`, () => HttpResponse.json({ email: 'priya@example.com', alerts: true, daily: true, recs: true, failures: true, quietFrom: '22:00', quietTo: '06:30', escalateMin: 30 })),
    http.patch(`${BASE}/api/me/notifications`, async ({ request }) => (record('notifications', await request.json()), HttpResponse.json({}))),
    http.get(`${BASE}/api/site/members`, () => HttpResponse.json(people)),
    http.patch(`${BASE}/api/site/members/:id`, async ({ request, params }) => (record(`member:${params.id}`, await request.json()), HttpResponse.json(people.members[1]))),
    http.delete(`${BASE}/api/site/members/:id`, ({ params }) => (record('remove', params.id), new HttpResponse(null, { status: 204 }))),
    http.post(`${BASE}/api/site/invites`, async ({ request }) => (record('invite', await request.json()), HttpResponse.json({}, { status: 201 }))),
    http.delete(`${BASE}/api/site/invites/:id`, ({ params }) => (record('revoke', params.id), new HttpResponse(null, { status: 204 })))
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <ThemeProvider defaultTheme="dark" storageKey="t">
          <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
            <SiteStreamProvider>
              <Settings />
            </SiteStreamProvider>
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

const bar = () => screen.findByRole('region', { name: 'Unsaved changes' })
const tab = (name: string) => userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))

describe('Settings save bar', () => {
  it('saves only what changed, to its own endpoint', async () => {
    setup('owner')
    const name = await screen.findByDisplayValue('Maple Grove School')
    await userEvent.clear(name)
    await userEvent.type(name, 'Maple Grove Public School')
    expect(await bar()).toHaveTextContent('Unsaved changes: Site')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.site).toEqual([{ name: 'Maple Grove Public School' }]))
    expect(calls.arrays).toBeUndefined()
  })

  it('keeps drafts while switching tabs, and discards them together', async () => {
    setup('manager', 'rules')
    await userEvent.click(await screen.findByRole('switch', { name: 'Peak shaving on' }))
    await tab('Calendar')
    fireEvent.change(await screen.findByLabelText('Weekdays open'), { target: { value: '08:00' } })
    expect(await bar()).toHaveTextContent('Unsaved changes: Rules, Calendar')
    expect(screen.getByRole('tab', { name: 'Rules •' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
    expect(screen.getByLabelText('Weekdays open')).toHaveValue('07:30')
  })

  it('saves rules one change at a time, and the approval settings', async () => {
    setup('owner', 'rules')
    await userEvent.click(await screen.findByRole('switch', { name: 'Peak shaving on' }))
    fireEvent.change(screen.getByLabelText('Forecast margin'), { target: { value: '15' } })
    await userEvent.selectOptions(screen.getByLabelText('Who can approve'), 'owner')
    expect(screen.getByTestId('declines-peak-shaving')).toHaveTextContent('Declined 2 times in 30 days: Bad timing for the building (2).')
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls['rule:peak-shaving']).toEqual([{ on: false, params: { marginKw: 15 } }]))
    expect(calls['rule:approval']).toEqual([{ params: { who: 'owner' } }])
    expect(calls['rule:ev-offpeak']).toBeUndefined()
  })
})

describe('roles', () => {
  it('lets installers change hardware but not site details', async () => {
    setup('installer')
    expect(await screen.findByDisplayValue('Maple Grove School')).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent('You can edit solar arrays and battery details. Site details are owner-only.')
    const size = screen.getByLabelText('Array 1 size')
    expect(size).toBeEnabled()
    fireEvent.change(size, { target: { value: '55' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.arrays).toEqual([[{ id: 'a1', name: 'Roof north', inverterId: 'invA', kwp: 55, tiltDeg: 10, azimuthDeg: 180 }]]))
  })

  it('shows the tariff to owners and managers only, and people to the owner only', async () => {
    setup('installer', 'tariff')
    expect(await screen.findByRole('note')).toHaveTextContent('The tariff is shown to owners and managers.')
    await tab('People')
    expect(screen.getByRole('note')).toHaveTextContent('Only the owner manages people.')
  })
})

describe('tariff', () => {
  it('previews prices as periods change, and flags gaps before saving', async () => {
    setup('owner', 'tariff')
    const strips = await screen.findAllByTestId('tariff-strip')
    expect(strips).toHaveLength(4) // two seasons × weekdays and weekends
    expect(strips[0]).toHaveTextContent('peak $0.27')
    fireEvent.change(screen.getByLabelText('Period 3 rate'), { target: { value: '0.3' } })
    await waitFor(() => expect(screen.getAllByTestId('tariff-strip')[0]).toHaveTextContent('peak $0.30'))
    fireEvent.change(screen.getByLabelText('Period 3 end'), { target: { value: '19:00' } })
    expect(await screen.findByRole('list', { name: 'Tariff problems' })).toHaveTextContent('No rate for 19:00–20:00 (weekdays, Apr–Oct)')
    expect(screen.getAllByTestId('strip-warning')[0]).toHaveTextContent('Part of the day has no rate')
  })

  it('saves a new version from today, and shows the server’s objection', async () => {
    setup('owner', 'tariff', { tariff422: true })
    await screen.findAllByTestId('tariff-strip')
    fireEvent.change(screen.getByLabelText('Period 3 rate'), { target: { value: '0.3' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.tariff).toHaveLength(1))
    const sent = calls.tariff[0] as { validFrom: string; periods: { rateCents: number }[] }
    expect(sent.validFrom >= '2026-09-01').toBe(true)
    expect(sent.periods[2].rateCents).toBe(30)
    expect(await screen.findByRole('list', { name: 'Tariff problems' })).toHaveTextContent('Valid from must be on or after 2026-09-01')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('Tariff: Valid from must be on or after 2026-09-01')
  })
})

describe('people', () => {
  it('changes a role and an end date, removes, invites and revokes straight away', async () => {
    setup('owner', 'people')
    await userEvent.selectOptions(await screen.findByLabelText('Role of Northside Solar'), 'manager')
    await waitFor(() => expect(calls['member:m3']).toEqual([{ role: 'manager' }]))
    fireEvent.change(screen.getByLabelText('Access until for Northside Solar'), { target: { value: '2027-01-31' } })
    await waitFor(() => expect(calls['member:m3']).toEqual([{ role: 'manager' }, { until: '2027-01-31' }]))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Northside Solar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Revoke the invite for sam@example.com' }))
    const form = screen.getByRole('form', { name: 'Invite someone' })
    await userEvent.type(within(form).getByLabelText('Email'), 'new@example.com')
    await userEvent.selectOptions(within(form).getByLabelText('Role'), 'installer')
    await userEvent.click(within(form).getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(calls.invite).toEqual([{ email: 'new@example.com', role: 'installer', until: null }]))
    expect(calls.remove).toEqual(['m3'])
    expect(calls.revoke).toEqual(['i1'])
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
  })
})

describe('site model and notifications', () => {
  it('lists the anchors and saves a removed one as a new version', async () => {
    setup('installer', 'model')
    expect(await screen.findByTestId('model-badge')).toHaveTextContent('Default model (App v2 demo scene)')
    expect(screen.getByText('Clicking the model needs a browser with WebGL; type the coordinates instead.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Heat pump' }))
    expect(await bar()).toHaveTextContent('Unsaved changes: Site model')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.model).toHaveLength(1))
    expect((calls.model[0] as { anchors: { key: string }[] }).anchors.map((a) => a.key)).toEqual(['pv', 'battery', 'grid', 'ev'])
  })

  it('uses a processed upload, says why others can’t be used, and checks files before sending them', async () => {
    setup('installer', 'model')
    const source = await screen.findByRole('radiogroup', { name: 'Model source' })
    expect(within(source).getByRole('radio', { name: /Generate from settings/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(source).getByRole('radio', { name: /Upload a 3D file/ }))
    const list = await screen.findByRole('list', { name: 'Uploaded models' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('School.glb180,000 triangles (from 420,000) · 793 KB · read as centimetres')
    expect(items[1]).toHaveTextContent('Can’t be used: The model is only 1.0 cm across. Export it in metres.')
    expect(within(items[1]).queryByRole('button', { name: 'Use this model' })).toBeNull()
    await userEvent.click(within(items[0]).getByRole('button', { name: 'Use this model' }))
    await waitFor(() => expect(calls.use).toEqual(['up1']))

    // Refused before upload, with the same reason the server would give.
    await userEvent.upload(screen.getByLabelText('3D model file'), new File(['skp'], 'site.skp'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^SketchUp files can’t be converted on this server/)
    expect(calls.upload).toBeUndefined()
  })

  it('switches an uploaded model back to the generated one from the save bar', async () => {
    setup('owner', 'model', { uploadedModel: true })
    expect(await screen.findByTestId('model-badge')).toHaveTextContent('Version 3 · School.glb')
    const source = screen.getByRole('radiogroup', { name: 'Model source' })
    expect(within(source).getByRole('radio', { name: /Upload a 3D file/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(source).getByRole('radio', { name: /Generate from settings/ }))
    expect(await bar()).toHaveTextContent('Unsaved changes: Site model')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.model).toHaveLength(1))
    expect(calls.model[0]).toMatchObject({ source: 'generated' })
  })

  it('places an anchor from typed coordinates, without the mouse', async () => {
    setup('installer', 'model')
    await userEvent.click(await screen.findByRole('button', { name: 'Type coordinates for Switchboard (hub)' }))
    const x = screen.getByLabelText('Switchboard (hub) x, metres')
    expect(x).toHaveFocus()
    await userEvent.clear(x)
    await userEvent.type(x, '600')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled() // outside the site
    await userEvent.clear(x)
    await userEvent.type(x, '2.5{Enter}')
    expect(await bar()).toHaveTextContent('Unsaved changes: Site model')
    expect(screen.getByText('2.5, 0.9, 1.9')).toBeInTheDocument()
  })
})

describe('Settings tabs', () => {
  it('move with the arrow keys, Home and End', async () => {
    setup('owner')
    const site = await screen.findByRole('tab', { name: 'Site' })
    expect(site).toHaveAttribute('tabindex', '0')
    site.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Tariff' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Tariff' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Tariff' })).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Notifications' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Site' })).toHaveAttribute('aria-selected', 'true')
  })

  it('saves your notifications, sending quiet hours together', async () => {
    setup('manager', 'notifications')
    await userEvent.click(await screen.findByRole('switch', { name: 'Daily summary at 07:00' }))
    fireEvent.change(screen.getByLabelText('Quiet hours from'), { target: { value: '21:00' } })
    expect(screen.getByRole('switch', { name: 'Command failures' })).toBeDisabled()
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.notifications).toEqual([{ daily: false, quietFrom: '21:00', quietTo: '06:30' }]))
  })
})
