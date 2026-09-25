/**
 * P2-07: each alert check on hand-made site states.
 */
import { describe, expect, it } from 'vitest'
import { alertKey } from '@ecomanage/shared'
import {
  batteryBelowReserve,
  commandAckSlow,
  commandFailed,
  demandNearCap,
  deviceSilent,
  gatewayBuffer,
  pvUnderperform,
  runChecks,
  type DeviceState,
  type SiteContext,
} from '../checks'

const NOW = new Date('2026-09-24T18:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60_000

const device = (id: string, type: string, extra: Partial<DeviceState> = {}): DeviceState => ({
  id,
  name: id.toUpperCase(),
  type,
  status: 'live',
  lastSeenAt: ago(5_000),
  addedAt: ago(30 * 24 * 60 * MIN),
  latest: null,
  ...extra,
})

const ctx = (over: Partial<SiteContext> = {}): SiteContext => ({
  now: NOW,
  demandCapKw: 120,
  devices: [],
  gateway: null,
  demand: null,
  commands: [],
  pvRatios: new Map(),
  active: new Set(),
  ...over,
})

describe('device silent', () => {
  it('flags a device silent for over 5 minutes, and judges every reporting device', () => {
    const r = deviceSilent(
      ctx({
        devices: [
          device('ev3', 'ev', { lastSeenAt: ago(6 * MIN) }),
          device('invA', 'pv', { lastSeenAt: ago(4 * MIN) }),
          device('new', 'submeter', { status: 'pending', lastSeenAt: ago(60 * MIN) }),
          device('never', 'ev', { lastSeenAt: null, addedAt: ago(20 * MIN) }),
          device('just-added', 'ev', { lastSeenAt: null, addedAt: ago(2 * MIN) }),
          device('unknown', 'ev', { lastSeenAt: null, addedAt: null }),
          device('gw', 'gateway', { lastSeenAt: ago(60 * MIN) }),
        ],
      })
    )
    expect(r.findings).toEqual([
      { ruleId: 'device-silent', deviceId: 'ev3', detail: 'EV3: no data for 6 min' },
      { ruleId: 'device-silent', deviceId: 'never', detail: 'NEVER: no data since it was added 20 min ago' },
    ])
    expect(r.evaluated).toEqual(['ev3', 'invA', 'never', 'just-added'].map((id) => alertKey('device-silent', id)))
  })
})

describe('PV underperforming', () => {
  const low = Array(24).fill(0.8)

  it('opens after 2 h of daylight below 90%', () => {
    const r = pvUnderperform(ctx({ devices: [device('invB', 'pv')], pvRatios: new Map([['invB', low], ['invA', Array(24).fill(1.02)]]) }))
    expect(r.findings).toEqual([{ ruleId: 'pv-underperform', deviceId: 'invB', detail: 'INVB at 80% of expected' }])
    expect(r.evaluated).toEqual([alertKey('pv-underperform', 'invB'), alertKey('pv-underperform', 'invA')])
  })

  it('needs the full 2 h, all of it low', () => {
    expect(pvUnderperform(ctx({ pvRatios: new Map([['invB', low.slice(1)]]) })).evaluated).toEqual([])
    expect(pvUnderperform(ctx({ pvRatios: new Map([['invB', [...low.slice(1), 0.95]]]) })).findings).toEqual([])
  })

  it('stays open until 1 h of daylight is back within 5% of expected', () => {
    const active = new Set([alertKey('pv-underperform', 'invB')])
    const hour = (x: number) => Array(12).fill(x)
    expect(pvUnderperform(ctx({ active, pvRatios: new Map([['invB', [0.8, ...hour(0.99).slice(1), 0.93]]]) })).findings).toHaveLength(1)
    expect(pvUnderperform(ctx({ active, pvRatios: new Map([['invB', [0.8, ...hour(0.94)]]]) })).findings).toHaveLength(1)
    const cleared = pvUnderperform(ctx({ active, pvRatios: new Map([['invB', [0.8, ...hour(0.97)]]]) }))
    expect(cleared.findings).toEqual([])
    // Less than an hour of daylight since it opened: not judged yet
    expect(pvUnderperform(ctx({ active, pvRatios: new Map([['invB', hour(1).slice(1)]]) })).evaluated).toEqual([])
    expect(cleared.evaluated).toEqual([alertKey('pv-underperform', 'invB')])
  })

  it('leaves an open alert alone overnight', () => {
    const r = pvUnderperform(ctx({ active: new Set([alertKey('pv-underperform', 'invB')]), pvRatios: new Map([['invB', []]]) }))
    expect(r).toEqual({ findings: [], evaluated: [] })
  })
})

describe('battery below reserve', () => {
  const bat = (soc: number, reserve: number, seenMsAgo = 5_000) =>
    device('bat', 'battery', { lastSeenAt: ago(seenMsAgo), latest: { ts: ago(seenMsAgo).toISOString(), p_kw: 0, soc_pct: soc, reserve_pct: reserve, q: 'ok' } })

  it('flags a battery more than half a point under its reserve', () => {
    expect(batteryBelowReserve(ctx({ devices: [bat(18, 20)] })).findings).toEqual([
      { ruleId: 'battery-below-reserve', deviceId: 'bat', detail: 'BAT at 18%, reserve 20%' },
    ])
    expect(batteryBelowReserve(ctx({ devices: [bat(19.7, 20)] })).findings).toEqual([])
  })

  it('once open, clears only at the reserve', () => {
    const active = new Set([alertKey('battery-below-reserve', 'bat')])
    expect(batteryBelowReserve(ctx({ active, devices: [bat(19.7, 20)] })).findings).toHaveLength(1)
    expect(batteryBelowReserve(ctx({ active, devices: [bat(20, 20)] })).findings).toEqual([])
  })

  it('judges only fresh readings with state of charge', () => {
    expect(batteryBelowReserve(ctx({ devices: [bat(5, 20, 3 * MIN)] })).evaluated).toEqual([])
    expect(batteryBelowReserve(ctx({ devices: [device('bat', 'battery', { latest: { ts: NOW.toISOString(), p_kw: 0, q: 'ok' } })] })).evaluated).toEqual([])
    expect(batteryBelowReserve(ctx({ devices: [device('bat', 'battery')] })).evaluated).toEqual([])
  })
})

describe('demand near the cap', () => {
  const demand = (projectedKw: number, startedMsAgo = 5 * MIN) => ({ intervalStart: ago(startedMsAgo).toISOString(), soFarKw: projectedKw, projectedKw })

  it('opens at 90% of the cap and closes under 85%', () => {
    expect(demandNearCap(ctx({ demand: demand(108) })).findings).toEqual([
      { ruleId: 'demand-near-cap', deviceId: null, detail: 'Heading for 108 kW this interval, cap 120 kW (90%)' },
    ])
    expect(demandNearCap(ctx({ demand: demand(105) })).findings).toEqual([])
    const active = new Set([alertKey('demand-near-cap', null)])
    expect(demandNearCap(ctx({ active, demand: demand(105) })).findings).toHaveLength(1)
    expect(demandNearCap(ctx({ active, demand: demand(100) })).findings).toEqual([])
  })

  it('needs a cap and a current interval', () => {
    expect(demandNearCap(ctx({ demandCapKw: null, demand: demand(500) })).evaluated).toEqual([])
    expect(demandNearCap(ctx({ demand: null })).evaluated).toEqual([])
    expect(demandNearCap(ctx({ demand: demand(500, 20 * MIN) })).evaluated).toEqual([])
  })
})

describe('commands', () => {
  const cmd = (id: string, status: string, over: object = {}) => ({ id, deviceId: 'bat', action: 'set_reserve', status, sentAt: ago(40_000), failedAt: null, error: null, ...over })

  it('flags a command unanswered for over 30 s, one alert per device', () => {
    const r = commandAckSlow(
      ctx({ devices: [device('bat', 'battery'), device('ev1', 'ev')], commands: [cmd('c1', 'sent'), cmd('c2', 'sent', { sentAt: ago(35_000) }), cmd('c3', 'sent', { deviceId: 'ev1', sentAt: ago(10_000) }), cmd('c4', 'acked')] })
    )
    expect(r.findings).toEqual([{ ruleId: 'command-ack-slow', deviceId: 'bat', detail: 'BAT: set_reserve sent 40 s ago, no answer' }])
    expect(r.evaluated).toEqual([alertKey('command-ack-slow', 'bat'), alertKey('command-ack-slow', 'ev1')])
  })

  it('reports each failed command of the last day once, keyed by command', () => {
    const r = commandFailed(
      ctx({
        devices: [device('bat', 'battery')],
        commands: [cmd('c1', 'failed', { failedAt: ago(MIN), error: 'rejected by device' }), cmd('c2', 'failed', { failedAt: ago(25 * 3600_000) }), cmd('c3', 'failed', { deviceId: 'x', failedAt: ago(MIN) })],
      })
    )
    expect(r.findings).toEqual([
      { ruleId: 'command-failed', deviceId: 'bat', detail: 'BAT: set_reserve failed (rejected by device)', eventKey: 'c1' },
      { ruleId: 'command-failed', deviceId: 'x', detail: 'x: set_reserve failed', eventKey: 'c3' },
    ])
    expect(r.evaluated).toEqual([])
  })
})

describe('gateway buffer', () => {
  const gw = (buffered: number, oldestMin: number | null) => ({ buffered, oldestBufferedTs: oldestMin === null ? null : ago(oldestMin * MIN).toISOString(), receivedAt: NOW.toISOString() })

  it('flags readings held for over an hour', () => {
    expect(gatewayBuffer(ctx({ gateway: gw(8400, 70) })).findings).toEqual([
      { ruleId: 'gateway-buffer', deviceId: null, detail: '8400 readings waiting, oldest from 70 min ago' },
    ])
    expect(gatewayBuffer(ctx({ gateway: gw(300, 20) })).findings).toEqual([])
    expect(gatewayBuffer(ctx({ gateway: gw(0, null) })).findings).toEqual([])
    expect(gatewayBuffer(ctx({ gateway: gw(0, null) })).evaluated).toEqual([alertKey('gateway-buffer', null)])
    expect(gatewayBuffer(ctx()).evaluated).toEqual([])
  })
})

describe('runChecks', () => {
  it('collects every check', () => {
    const r = runChecks(ctx({ devices: [device('ev3', 'ev', { lastSeenAt: ago(10 * MIN) })], gateway: { buffered: 0, oldestBufferedTs: null, receivedAt: NOW.toISOString() } }))
    expect(r.findings.map((f) => f.ruleId)).toEqual(['device-silent'])
    expect(r.evaluated).toEqual([alertKey('device-silent', 'ev3'), alertKey('command-ack-slow', 'ev3'), alertKey('gateway-buffer', null)])
  })
})
