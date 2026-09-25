import { describe, expect, it } from 'vitest'
import { batteryLive, demandNow, siteEventsChannel, siteFlows, type LiveDevice } from '../live'

const t = (iso: string) => new Date(iso)

describe('demandNow', () => {
  const start = t('2026-09-24T19:15:00Z')

  it('averages import since the interval start and projects the rest at the current power', () => {
    // 5 minutes in, 8 kWh imported (96 kW average), 120 kW now
    const d = demandNow({ intervalStart: start, now: t('2026-09-24T19:20:00Z'), startKwh: 1000, nowKwh: 1008, currentKw: 120 })
    expect(d).toEqual({ intervalStart: '2026-09-24T19:15:00.000Z', soFarKw: 96, projectedKw: 112 })
  })

  it('uses the current power in the first 30 seconds', () => {
    const d = demandNow({ intervalStart: start, now: t('2026-09-24T19:15:10Z'), startKwh: 1000, nowKwh: 1000.2, currentKw: 80 })
    expect(d.soFarKw).toBe(80)
  })

  it('ignores export and counter resets, and stops projecting at the end of the interval', () => {
    const exporting = demandNow({ intervalStart: start, now: t('2026-09-24T19:20:00Z'), startKwh: 1000, nowKwh: 999, currentKw: -20 })
    expect(exporting).toMatchObject({ soFarKw: 0, projectedKw: 0 })
    const late = demandNow({ intervalStart: start, now: t('2026-09-24T19:40:00Z'), startKwh: 1000, nowKwh: 1025, currentKw: 500 })
    expect(late).toMatchObject({ soFarKw: 100, projectedKw: 100 })
    const thirty = demandNow({ intervalStart: start, now: t('2026-09-24T19:20:00Z'), minutes: 30, startKwh: 0, nowKwh: 5, currentKw: 60 })
    expect(thirty.projectedKw).toBe(60)
  })
})

describe('siteFlows', () => {
  const now = t('2026-09-24T16:40:10Z')
  const r = (p: number, ts = '2026-09-24T16:40:05Z') => ({ ts, p_kw: p, q: 'ok' as const })
  const devices: LiveDevice[] = [
    { id: 'a', type: 'pv', latest: r(36.1) },
    { id: 'b', type: 'pv', latest: r(25.3) },
    { id: 'bat', type: 'battery', latest: r(20) },
    { id: 'm', type: 'meter', latest: r(12.8) },
    { id: 'e1', type: 'ev', latest: r(-7.4) },
    { id: 'e3', type: 'ev', latest: r(-3, '2026-09-24T16:33:08Z') },
    { id: 'hp', type: 'heatpump', latest: r(-18) },
    { id: 'gw', type: 'gateway', latest: null },
  ]

  it('sums fresh readings per type and works out the building remainder', () => {
    expect(siteFlows(devices, now)).toEqual({ pv: 61.4, battery: 20, grid: 12.8, ev: -7.4, heatpump: -18, building: 68.8, stale: ['e3'] })
  })

  it('leaves grid and building empty when the meter is stale', () => {
    const noMeter = devices.map((d) => (d.id === 'm' ? { ...d, latest: null } : d))
    expect(siteFlows(noMeter, now)).toMatchObject({ grid: null, building: null, stale: ['m', 'e3'] })
    expect(siteFlows(devices.filter((d) => d.type !== 'meter'), now).grid).toBeNull()
  })
})

describe('batteryLive', () => {
  it('works out time left from the reserve, usable capacity and health', () => {
    const b = batteryLive({ ts: 'x', p_kw: 20, soc_pct: 68.2, reserve_pct: 20, usable_kwh: 200, soh_pct: 97, q: 'ok' })
    // (68.2 - 20)% x 200 kWh x 0.97 / 20 kW = 4.675 h = 280.5 min
    expect(b).toEqual({ socPct: 68.2, reservePct: 20, usableKwh: 200, pKw: 20, minutesLeft: 281 })
  })

  it('hides time left when charging, idle or unknown', () => {
    expect(batteryLive({ ts: 'x', p_kw: -10, soc_pct: 50, reserve_pct: 20, usable_kwh: 200, q: 'ok' }).minutesLeft).toBeNull()
    expect(batteryLive({ ts: 'x', p_kw: 10, q: 'ok' }).minutesLeft).toBeNull()
    expect(batteryLive({ ts: 'x', p_kw: 10, soc_pct: 10, reserve_pct: 20, usable_kwh: 200, q: 'ok' }).minutesLeft).toBe(0)
    expect(batteryLive(null)).toEqual({ socPct: null, reservePct: null, usableKwh: null, pKw: 0, minutesLeft: null })
  })
})

it('names the per-site event channel', () => {
  expect(siteEventsChannel('s1')).toBe('site:s1:events')
})
