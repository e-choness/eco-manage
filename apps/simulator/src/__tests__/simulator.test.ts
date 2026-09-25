/**
 * P1-05 acceptance: 24 simulated hours at 60× give an energy balance within 1%, a school-day peak
 * of about 130 kW without control, and every fault type behaves as specified.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, parseTopic, topics, type TelemetryReading } from '@ecomanage/shared'
import { SimClock } from '../clock'
import { SiteEngine } from '../engine/site'
import { Gateway, SCAN_FINDS } from '../gateway'

const START = new Date('2026-09-24T04:00:00Z') // Thursday, local midnight in Toronto, fall term
const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!

interface Sent {
  topic: string
  payload: unknown
}

const makeSite = (seed = 42, start = START) => {
  const engine = new SiteEngine({ tz: DEMO_SITE.tz, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed, devices: DEMO_DEVICES }, start)
  const sent: Sent[] = []
  const gateway = new Gateway(engine, DEMO_SITE_ID, (topic, payload) => sent.push({ topic, payload }))
  const run = (seconds: number, step = 5) => {
    for (let t = 0; t < seconds; t += step) {
      engine.step(step)
      gateway.tick()
    }
  }
  return { engine, gateway, sent, run }
}

const readingsFor = (sent: Sent[], key: string): TelemetryReading[] =>
  sent
    .filter((s) => s.topic === topics.telemetry(DEMO_SITE_ID, dev(key).id))
    .flatMap((s) => ('items' in (s.payload as object) ? (s.payload as { items: TelemetryReading[] }).items : [s.payload as TelemetryReading]))

describe('clock', () => {
  it('runs 24 simulated hours in 24 real minutes at 60×', () => {
    const clock = new SimClock(START, 60, 0)
    expect(clock.now(24 * 60_000).toISOString()).toBe('2026-09-25T04:00:00.000Z')
    clock.setSpeed(1, 24 * 60_000)
    expect(clock.now(25 * 60_000).toISOString()).toBe('2026-09-25T04:01:00.000Z')
    expect(() => new SimClock(START, 61)).toThrow(RangeError)
    expect(() => clock.setSpeed(0)).toThrow(RangeError)
  })
})

it('starts counters where the site would be after running since commissioning, so restarts never go backwards', () => {
  const earlier = makeSite(42, new Date('2026-09-24T04:00:00Z')).engine
  const later = makeSite(42, new Date('2026-09-25T04:00:00Z')).engine
  for (const key of ['meter', 'invA', 'bat', 'ev1', 'hp']) {
    const a = earlier.countersOf(key)
    const b = later.countersOf(key)
    expect(b.inKwh).toBeGreaterThanOrEqual(a.inKwh)
    expect(b.outKwh).toBeGreaterThanOrEqual(a.outKwh)
  }
  expect(later.countersOf('meter').inKwh - earlier.countersOf('meter').inKwh).toBeCloseTo(22 * 24, 0)
})

describe('24 simulated hours on a school day', () => {
  const site = makeSite()
  beforeAll(() => site.run(24 * 3600))

  it('balances energy within 1%', () => {
    const { engine } = site
    const c = (k: string) => engine.countersOf(k)
    const before = makeSite().engine // fresh counters at the start
    const d = (k: string, f: 'inKwh' | 'outKwh') => c(k)[f] - before.countersOf(k)[f]
    const sources = d('invA', 'outKwh') + d('invB', 'outKwh') + d('bat', 'outKwh') + d('meter', 'inKwh')
    const sinks =
      engine.buildingEnergyKwh() +
      ['ev1', 'ev2', 'ev3', 'ev4', 'hp'].reduce((s, k) => s + d(k, 'inKwh'), 0) +
      d('bat', 'inKwh') +
      d('meter', 'outKwh')
    expect(sources).toBeGreaterThan(500)
    expect(Math.abs(sources - sinks) / sources).toBeLessThan(0.01)
  })

  it('peaks at about 130 kW of 15-minute grid demand with no control', () => {
    const meter = readingsFor(site.sent, 'meter')
    const at = new Map(meter.map((r) => [Date.parse(r.ts), r.e_in_kwh!]))
    let peak = 0
    let peakAt = ''
    for (const [t, eIn] of at) {
      const end = at.get(t + 15 * 60_000)
      if (new Date(t).getUTCMinutes() % 15 !== 0 || end === undefined) continue
      const kw = (end - eIn) * 4
      if (kw > peak) [peak, peakAt] = [kw, new Date(t).toISOString()]
    }
    expect(peak).toBeGreaterThan(110)
    expect(peak).toBeLessThan(150)
    // Afternoon, when buses charge and the heat pump cools (local 13:00–17:30 = 17:00–21:30Z)
    expect(peakAt >= '2026-09-24T17:00' && peakAt <= '2026-09-24T21:30').toBe(true)
  })

  it('publishes every device every 5 seconds with valid signs', () => {
    expect(readingsFor(site.sent, 'invA')).toHaveLength(24 * 720)
    expect(readingsFor(site.sent, 'invA').every((r) => r.p_kw >= 0)).toBe(true)
    expect(readingsFor(site.sent, 'hp').every((r) => r.p_kw <= 0)).toBe(true)
    expect(readingsFor(site.sent, 'ev1').some((r) => r.p_kw < -20)).toBe(true)
    const noon = readingsFor(site.sent, 'invA').find((r) => r.ts === '2026-09-24T17:00:00.000Z')!
    expect(noon.p_kw).toBeGreaterThan(5)
    const night = readingsFor(site.sent, 'invA').find((r) => r.ts === '2026-09-24T07:00:00.000Z')!
    expect(night.p_kw).toBe(0)
  })

  it('keeps the battery inside its limits', () => {
    const soc = readingsFor(site.sent, 'bat').map((r) => r.soc_pct!)
    expect(Math.min(...soc)).toBeGreaterThanOrEqual(20 - 0.5)
    expect(Math.max(...soc)).toBeLessThanOrEqual(100)
    expect(readingsFor(site.sent, 'bat').every((r) => Math.abs(r.p_kw) <= 60.001)).toBe(true)
  })

  it('is deterministic for a seed', () => {
    const a = makeSite(7)
    const b = makeSite(7)
    const c = makeSite(8)
    for (const s of [a, b, c]) s.run(3 * 3600, 60)
    expect(readingsFor(a.sent, 'meter')).toEqual(readingsFor(b.sent, 'meter'))
    expect(readingsFor(a.sent, 'meter')).not.toEqual(readingsFor(c.sent, 'meter'))
  })
})

describe('faults', () => {
  const midday = new Date('2026-09-24T16:00:00Z')

  it('device offline: the device goes silent, then reports again after a reset', () => {
    const { gateway, sent, run } = makeSite(42, midday)
    gateway.addFault({ type: 'device-offline', device: 'ev3' })
    run(600)
    expect(readingsFor(sent, 'ev3')).toHaveLength(0)
    expect(readingsFor(sent, 'ev1').length).toBeGreaterThan(100)
    gateway.handleMessage(topics.command(DEMO_SITE_ID, 'fix1'), {
      deviceId: dev('ev3').id,
      action: 'reset',
      params: {},
      expiresAt: '2026-09-24T17:00:00Z',
      revertAt: null,
    })
    expect(sent.at(-1)).toEqual({ topic: topics.commandAck(DEMO_SITE_ID, 'fix1'), payload: expect.objectContaining({ ok: true }) })
    run(10)
    expect(readingsFor(sent, 'ev3').length).toBeGreaterThan(0)
  })

  it('inverter offline for a set time clears by itself', () => {
    const { gateway, sent, run } = makeSite(42, midday)
    gateway.addFault({ type: 'device-offline', device: 'invA', minutes: 10 })
    run(1200)
    const ts = readingsFor(sent, 'invA').map((r) => r.ts)
    expect(ts[0] >= '2026-09-24T16:10:00').toBe(true)
  })

  it('meter data gap: no meter readings for the gap, other devices unaffected', () => {
    const { gateway, sent, run } = makeSite(42, midday)
    gateway.addFault({ type: 'meter-gap', minutes: 20 })
    run(1800)
    const meter = readingsFor(sent, 'meter').map((r) => r.ts)
    expect(meter.every((t) => t >= '2026-09-24T16:20:00')).toBe(true)
    expect(readingsFor(sent, 'invB')).toHaveLength(360)
  })

  it('gateway offline: buffers everything and resends it in order, in batches', () => {
    const { gateway, sent, run } = makeSite(42, midday)
    gateway.addFault({ type: 'gateway-offline', minutes: 30 })
    run(1795) // 16:29:55, still offline
    expect(sent).toHaveLength(0)
    expect(gateway.bufferedCount()).toBe(9 * 359)
    run(5) // 16:30:00, back online
    const batches = sent.filter((s) => 'items' in (s.payload as object))
    expect(batches).toHaveLength(9)
    expect(sent.indexOf(batches[0])).toBe(0)
    const meter = readingsFor(sent, 'meter')
    expect(meter.length).toBe(360)
    expect(meter.map((r) => r.ts)).toEqual([...meter.map((r) => r.ts)].sort())
    expect(gateway.bufferedCount()).toBe(0)
  })

  it('command rejected: the next command is refused, later ones work', () => {
    const { gateway, sent } = makeSite(42, midday)
    gateway.addFault({ type: 'command-rejected' })
    const cmd = (id: string) =>
      gateway.handleMessage(topics.command(DEMO_SITE_ID, id), {
        deviceId: dev('bat').id,
        action: 'set_reserve',
        params: { pct: 30 },
        expiresAt: '2026-09-24T17:00:00Z',
        revertAt: null,
      })
    cmd('c1')
    cmd('c2')
    expect(sent.map((s) => s.payload)).toEqual([
      expect.objectContaining({ ok: false, error: 'rejected by device' }),
      expect.objectContaining({ ok: true }),
    ])
    expect(gateway.activeFaults()).toHaveLength(0)
  })

  it('20% output drop on one inverter', () => {
    const { engine, gateway, run } = makeSite(42, midday)
    run(5)
    const ratio = () => engine.powerOf('invB') / 38 / (engine.powerOf('invA') / 48)
    expect(ratio()).toBeCloseTo(1, 1)
    gateway.addFault({ type: 'output-drop', device: 'invB' })
    run(5)
    expect(ratio()).toBeCloseTo(0.8, 1)
    gateway.clearFaults()
    run(5)
    expect(ratio()).toBeCloseTo(1, 1)
  })
})

describe('commands', () => {
  const t0 = new Date('2026-09-24T18:00:00Z') // 14:00 local
  const send = (gateway: Gateway, id: string, action: string, params: Record<string, unknown>, expiresAt = '2026-09-24T19:00:00Z', key = 'bat') =>
    gateway.handleMessage(topics.command(DEMO_SITE_ID, id), { deviceId: dev(key).id, action, params, expiresAt, revertAt: null })

  it('rejects expired commands and params outside the profile limits', () => {
    const { gateway, sent } = makeSite(42, t0)
    send(gateway, 'old', 'set_reserve', { pct: 30 }, '2026-09-24T17:59:00Z')
    send(gateway, 'low', 'set_reserve', { pct: 5 })
    send(gateway, 'bad', 'launch', {})
    expect(sent.map((s) => (s.payload as { error: string }).error)).toEqual([
      'expired',
      'pct must be at least 10%',
      'action launch not supported by sunspec-storage-802@2',
    ])
  })

  it('force discharge runs until its end time, then the battery returns to default', () => {
    const { engine, gateway, run } = makeSite(42, t0)
    send(gateway, 'c1', 'force_discharge', { kw: 30, until: '2026-09-24T18:30:00Z' })
    run(60)
    expect(engine.powerOf('bat')).toBe(30)
    run(1800)
    expect(engine.powerOf('bat')).not.toBe(30)
  })

  it('limits EV current and sets the heat pump SG-Ready mode', () => {
    const { engine, gateway, run } = makeSite(42, new Date('2026-09-24T19:30:00Z')) // 15:30 local, buses charging
    run(60)
    expect(engine.powerOf('ev1')).toBeCloseTo(-22)
    send(gateway, 'e1', 'limit_current', { amps: 16, until: '2026-09-24T20:00:00Z' }, '2026-09-24T20:00:00Z', 'ev1')
    send(gateway, 'h1', 'sg_mode', { mode: 1, until: '2026-09-24T20:00:00Z' }, '2026-09-24T20:00:00Z', 'hp')
    run(10)
    expect(engine.powerOf('ev1')).toBeCloseTo(-11)
    expect(engine.powerOf('hp')).toBe(0)
  })

  it('ignores commands for other sites', () => {
    const { gateway, sent } = makeSite(42, t0)
    gateway.handleMessage(topics.command('650000000000000000000099', 'x'), {})
    expect(sent).toHaveLength(0)
  })
})

describe('gateway config (P2-06)', () => {
  const t0 = new Date('2026-09-24T18:00:00Z')
  it('takes the battery floor from the retained config and keeps the reserve above it', () => {
    const { engine, gateway } = makeSite(42, t0)
    expect(engine.batteryState()).toMatchObject({ floorPct: 10, reservePct: 20 })
    gateway.handleMessage(topics.gatewayConfig(DEMO_SITE_ID), { ts: t0.toISOString(), batteryFloorPct: 30 })
    expect(engine.batteryState()).toMatchObject({ floorPct: 30, reservePct: 30 })
    // A reserve command can't go below the new floor
    gateway.handleMessage(topics.command(DEMO_SITE_ID, 'r1'), {
      deviceId: dev('bat').id,
      action: 'set_reserve',
      params: { pct: 15 },
      expiresAt: new Date(t0.getTime() + 60_000).toISOString(),
      revertAt: null,
    })
    expect(engine.batteryState().reservePct).toBe(30)
  })

  it('ignores config for other sites and malformed config', () => {
    const { engine, gateway } = makeSite(42, t0)
    gateway.handleMessage(topics.gatewayConfig('650000000000000000000099'), { ts: t0.toISOString(), batteryFloorPct: 30 })
    gateway.handleMessage(topics.gatewayConfig(DEMO_SITE_ID), { batteryFloorPct: 'lots' })
    expect(engine.batteryState().floorPct).toBe(10)
  })
})

describe('jobs', () => {
  it('scan finds the kitchen sub-meter, commission makes it report', () => {
    const { gateway, sent, run } = makeSite(42, new Date('2026-09-24T16:30:00Z'))
    gateway.handleMessage(topics.job(DEMO_SITE_ID, 'scan1'), { type: 'scan' })
    expect(sent[0]).toEqual({ topic: topics.jobResult(DEMO_SITE_ID, 'scan1'), payload: expect.objectContaining({ ok: true, data: { found: [SCAN_FINDS] } }) })

    const subId = '650000000000000000000201'
    gateway.handleMessage(topics.job(DEMO_SITE_ID, 'com1'), { type: 'commission', params: { deviceId: subId, address: SCAN_FINDS.address } })
    const result = sent[1].payload as { ok: boolean; data: { checks: { name: string; pass: boolean }[] } }
    expect(result.ok).toBe(true)
    expect(result.data.checks.map((c) => c.name)).toEqual(['Live read', 'Sign check: import positive', 'Energy balance within 5%'])

    run(10)
    const subReadings = sent.filter((s) => parseTopic(s.topic)?.kind === 'telemetry' && s.topic.includes(subId))
    expect(subReadings.length).toBeGreaterThan(0)
    expect((subReadings[0].payload as TelemetryReading).p_kw).toBeLessThan(0)

    gateway.handleMessage(topics.job(DEMO_SITE_ID, 'scan2'), { type: 'scan' })
    expect(sent.at(-1)!.payload).toEqual(expect.objectContaining({ data: { found: [] } }))
  })

  it('refuses to commission an unknown address', () => {
    const { gateway, sent } = makeSite()
    gateway.handleMessage(topics.job(DEMO_SITE_ID, 'j'), { type: 'commission', params: { deviceId: 'x', address: 'nowhere' } })
    expect(sent[0].payload).toEqual(expect.objectContaining({ ok: false }))
  })
})

describe('restarts', () => {
  it('resumes counters and battery charge, ageing counters over the downtime', () => {
    const first = makeSite(42, new Date('2026-09-24T16:00:00Z'))
    first.run(600)
    const saved = first.engine.saveState()

    // back 30 minutes later
    const second = makeSite(42, new Date('2026-09-24T16:40:00Z')).engine
    expect(second.restoreState(saved)).toBe(true)
    const meter = second.countersOf('meter')
    const expected = saved.counters.meter.inKwh + 22 * 0.5
    expect(meter.inKwh).toBeCloseTo(expected, 3)
    expect(meter.inKwh).toBeGreaterThan(first.engine.countersOf('meter').inKwh)
    expect(second.batteryState().socPct).toBeCloseTo(first.engine.batteryState().socPct)
  })

  it('ignores state saved in the future', () => {
    const later = makeSite(42, new Date('2026-09-25T00:00:00Z')).engine.saveState()
    const engine = makeSite(42, new Date('2026-09-24T00:00:00Z')).engine
    const before = engine.countersOf('meter')
    expect(engine.restoreState(later)).toBe(false)
    expect(engine.countersOf('meter')).toEqual(before)
  })
})
