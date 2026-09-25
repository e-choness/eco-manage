/**
 * P2-07: every check against the simulator with the matching fault injected. The simulated gateway
 * publishes exactly what a real one would; this test plays the part of ingest (latest readings,
 * gateway status, the demand meter) and of the API (command status from acks), then runs the checks.
 */
import { describe, expect, it } from 'vitest'
import {
  DEMO_DEVICES,
  DEMO_SITE,
  DEMO_SITE_ID,
  alertKey,
  demandNow,
  intervalStart,
  parseTopic,
  readingsOf,
  topics,
  type TelemetryMessage,
  type TelemetryReading,
} from '@ecomanage/shared'
import { SiteEngine } from '@ecomanage/simulator/engine'
import { Gateway } from '@ecomanage/simulator/gateway'
import { runChecks, type CommandState, type SiteContext } from '../checks'
import { bucketize, pvRatios } from '../pv'

const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!
const STEP_S = 5

/** A simulated site, with the cloud's view of it built from what the gateway publishes. */
const site = (start: string) => {
  const engine = new SiteEngine({ tz: DEMO_SITE.tz, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: 42, devices: DEMO_DEVICES }, new Date(start))
  const latest = new Map<string, { reading: TelemetryReading; at: Date }>()
  const history: { deviceId: string; reading: TelemetryReading }[] = []
  const acks = new Map<string, { ok: boolean; error?: string }>()
  let gw: SiteContext['gateway'] = null
  const gateway = new Gateway(engine, DEMO_SITE_ID, (topic, payload) => {
    const t = parseTopic(topic)
    if (t?.kind === 'telemetry') {
      for (const reading of readingsOf(payload as TelemetryMessage)) {
        history.push({ deviceId: t.deviceId, reading })
        const prev = latest.get(t.deviceId)
        if (!prev || reading.ts >= prev.reading.ts) latest.set(t.deviceId, { reading, at: engine.now })
      }
    }
    if (t?.kind === 'gatewayStatus') {
      const s = payload as { buffered: number; oldestBufferedTs: string | null }
      gw = { buffered: s.buffered, oldestBufferedTs: s.oldestBufferedTs, receivedAt: engine.now.toISOString() }
    }
    if (t?.kind === 'commandAck') acks.set(t.commandId, payload as { ok: boolean; error?: string })
  })
  const commands: CommandState[] = []

  const run = (seconds: number, every?: (now: Date) => void) => {
    for (let s = 0; s < seconds; s += STEP_S) {
      engine.step(STEP_S)
      gateway.tick()
      if (engine.now.getTime() % 30_000 === 0) gateway.publishGatewayStatus()
      every?.(engine.now)
    }
  }

  /** Sends a command the way the API will (P3-04) and tracks it from the acks. */
  const send = (id: string, key: string, action: string, params: object) => {
    commands.push({ id, deviceId: dev(key).id, action, status: 'sent', sentAt: engine.now, failedAt: null, error: null })
    gateway.handleMessage(topics.command(DEMO_SITE_ID, id), {
      deviceId: dev(key).id,
      action,
      params,
      expiresAt: new Date(engine.now.getTime() + 10 * 60_000).toISOString(),
      revertAt: null,
    })
  }

  const context = (active = new Set<string>()): SiteContext => {
    const now = engine.now
    for (const c of commands) {
      const ack = acks.get(c.id)
      if (ack && c.status === 'sent') Object.assign(c, ack.ok ? { status: 'acked' } : { status: 'failed', failedAt: now, error: ack.error ?? null })
    }
    // Demand from the meter's import counter, as ingest's demand tracker does
    const meter = history.filter((h) => h.deviceId === dev('meter').id)
    const start = intervalStart(now, DEMO_SITE.tz)
    const atStart = meter.filter((h) => Date.parse(h.reading.ts) <= start.getTime()).at(-1) ?? meter[0]
    const last = meter.at(-1)
    const kwp = new Map(DEMO_DEVICES.filter((d) => d.type === 'pv').map((d) => [d.id, d.kwp!]))
    const pvPoints = history.filter((h) => kwp.has(h.deviceId)).map((h) => ({ deviceId: h.deviceId, ts: new Date(h.reading.ts), kw: h.reading.p_kw }))
    return {
      now,
      demandCapKw: DEMO_SITE.demandCapKw,
      devices: DEMO_DEVICES.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: 'live',
        lastSeenAt: latest.get(d.id) ? new Date(latest.get(d.id)!.reading.ts) : null,
        latest: latest.get(d.id)?.reading ?? null,
      })),
      gateway: gw,
      demand:
        last && atStart
          ? demandNow({ intervalStart: start, now, startKwh: atStart.reading.e_in_kwh ?? 0, nowKwh: last.reading.e_in_kwh ?? 0, currentKw: last.reading.p_kw })
          : null,
      commands,
      pvRatios: pvRatios(bucketize(pvPoints), kwp),
      active,
    }
  }

  const findings = (active?: Set<string>) => runChecks(context(active)).findings
  return { engine, gateway, run, send, context, findings }
}

describe('simulator faults', () => {
  it('device-offline: the silent charger is flagged after 5 minutes, and clears when it is back', () => {
    const s = site('2026-09-24T16:00:00Z')
    s.run(60)
    s.gateway.addFault({ type: 'device-offline', device: 'ev3' })
    s.run(4 * 60)
    expect(s.findings().filter((f) => f.ruleId === 'device-silent')).toEqual([])
    s.run(2 * 60)
    expect(s.findings().filter((f) => f.ruleId === 'device-silent')).toEqual([expect.objectContaining({ deviceId: dev('ev3').id })])
    s.gateway.clearFaults()
    s.run(10)
    expect(s.findings().filter((f) => f.ruleId === 'device-silent')).toEqual([])
  })

  it('output-drop: inverter B at 80% is flagged after 2 h of daylight; inverter A is not', () => {
    const faulty = site('2026-09-24T14:00:00Z') // 10:00 EDT
    faulty.gateway.addFault({ type: 'output-drop', device: 'invB' })
    faulty.run(90 * 60)
    expect(faulty.findings().filter((f) => f.ruleId === 'pv-underperform')).toEqual([])
    faulty.run(40 * 60)
    const pv = faulty.findings().filter((f) => f.ruleId === 'pv-underperform')
    expect(pv).toEqual([expect.objectContaining({ deviceId: dev('invB').id, detail: expect.stringMatching(/^Inverter B at (7[5-9]|8[0-5])% of expected$/) })])

    const healthy = site('2026-09-24T14:00:00Z')
    healthy.run(130 * 60)
    expect(healthy.findings().filter((f) => f.ruleId === 'pv-underperform')).toEqual([])
  })

  it('reserve raised above the charge: the battery is flagged below its reserve', () => {
    const s = site('2026-09-24T16:00:00Z')
    s.run(60)
    expect(s.findings().filter((f) => f.ruleId === 'battery-below-reserve')).toEqual([])
    s.gateway.handleMessage(topics.gatewayConfig(DEMO_SITE_ID), { ts: s.engine.now.toISOString(), batteryFloorPct: 90 })
    s.run(30)
    expect(s.findings().filter((f) => f.ruleId === 'battery-below-reserve')).toEqual([
      expect.objectContaining({ deviceId: dev('bat').id, detail: expect.stringMatching(/reserve 90%$/) }),
    ])
  })

  it('school-day afternoon without control: demand heads past 90% of the 120 kW cap', () => {
    const s = site('2026-09-24T18:30:00Z') // 14:30 EDT, Thursday in term
    let seen = false
    s.run(75 * 60, (now) => {
      if (now.getTime() % 60_000 === 0 && s.findings().some((f) => f.ruleId === 'demand-near-cap')) seen = true
    })
    expect(seen).toBe(true)
  })

  it('gateway-offline: a command goes unanswered and is flagged after 30 s', () => {
    const s = site('2026-09-24T16:00:00Z')
    s.run(30)
    s.gateway.addFault({ type: 'gateway-offline' })
    s.send('c-slow', 'bat', 'set_reserve', { pct: 30 })
    s.run(20)
    expect(s.findings().filter((f) => f.ruleId === 'command-ack-slow')).toEqual([])
    s.run(20)
    expect(s.findings().filter((f) => f.ruleId === 'command-ack-slow')).toEqual([expect.objectContaining({ deviceId: dev('bat').id })])

    const ok = site('2026-09-24T16:00:00Z')
    ok.run(30)
    ok.send('c-ok', 'bat', 'set_reserve', { pct: 30 })
    ok.run(40)
    expect(ok.findings().filter((f) => f.ruleId.startsWith('command'))).toEqual([])
  })

  it('command-rejected: the failed command is reported once, keyed by its id', () => {
    const s = site('2026-09-24T16:00:00Z')
    s.run(30)
    s.gateway.addFault({ type: 'command-rejected', device: 'bat' })
    s.send('c-bad', 'bat', 'set_reserve', { pct: 30 })
    s.run(5)
    expect(s.findings().filter((f) => f.ruleId === 'command-failed')).toEqual([
      { ruleId: 'command-failed', deviceId: dev('bat').id, detail: 'Battery: set_reserve failed (rejected by device)', eventKey: 'c-bad' },
    ])
  })

  it('gateway-offline for 70 min: the backlog is flagged while it drains, then clears', () => {
    const s = site('2026-09-24T16:00:00Z')
    s.run(60)
    s.gateway.addFault({ type: 'gateway-offline' })
    s.run(70 * 60)
    s.gateway.clearFaults()
    s.run(STEP_S) // it reports status (with the backlog) as soon as it is back
    const key = alertKey('gateway-buffer', null)
    expect(s.findings().filter((f) => f.ruleId === 'gateway-buffer')).toEqual([expect.objectContaining({ detail: expect.stringMatching(/readings waiting, oldest from 7\d min ago$/) })])
    s.run(10 * 60)
    expect(s.findings(new Set([key])).filter((f) => f.ruleId === 'gateway-buffer')).toEqual([])
  })
})
