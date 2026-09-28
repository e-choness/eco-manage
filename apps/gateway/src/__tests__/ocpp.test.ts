/**
 * P5-04: the gateway as the chargers' OCPP 1.6J central system. A test charger connects over a
 * real WebSocket, reports a session, and gets the cloud's limit as a charging profile.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { getProfile } from '@ecomanage/profiles'
import { ocppDriver } from '../drivers/ocpp'
import { OcppServer } from '../ocpp/server'

const server = new OcppServer({ port: 0, host: '127.0.0.1', heartbeatS: 30, password: 'bench-secret' })
const profile = getProfile('ocpp16-generic@1')!

/** A charger: sends requests and answers the central system with `reply`. */
const charger = async (id: string, reply: (action: string, payload: Record<string, unknown>) => Record<string, unknown> = () => ({ status: 'Accepted' }), password = 'bench-secret') => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ocpp/${id}`, 'ocpp1.6', { headers: { Authorization: `Basic ${Buffer.from(`${id}:${password}`).toString('base64')}` } })
  const received: { action: string; payload: Record<string, unknown> }[] = []
  const answers = new Map<string, (v: unknown) => void>()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as unknown[]
    if (msg[0] === 2) {
      received.push({ action: String(msg[2]), payload: msg[3] as Record<string, unknown> })
      ws.send(JSON.stringify([3, msg[1], reply(String(msg[2]), msg[3] as Record<string, unknown>)]))
    } else answers.get(String(msg[1]))?.(msg)
  })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  let n = 0
  const send = (action: string, payload: Record<string, unknown>) =>
    new Promise<unknown[]>((resolve) => {
      const uid = `${id}-${++n}`
      answers.set(uid, resolve as (v: unknown) => void)
      ws.send(JSON.stringify([2, uid, action, payload]))
    })
  return { ws, send, received }
}

beforeAll(async () => {
  await server.start()
})

afterAll(async () => {
  await server.close()
})

describe('what chargers send', () => {
  it('boots, reports a session and meter values, and reads as the profile says', async () => {
    const c = await charger('EVC-01')
    expect(await c.send('BootNotification', { chargePointVendor: 'Wallbox', chargePointModel: 'Pulsar Plus' })).toEqual([3, 'EVC-01-1', { status: 'Accepted', currentTime: expect.any(String), interval: 30 }])
    await c.send('StatusNotification', { connectorId: 1, errorCode: 'NoError', status: 'Charging' })
    const start = (await c.send('StartTransaction', { connectorId: 1, idTag: 'BUS-7', meterStart: 120_000, timestamp: '2026-09-28T08:00:00Z' })) as [number, string, { transactionId: number }]
    expect(start[2].transactionId).toBeGreaterThan(0)
    await c.send('MeterValues', {
      connectorId: 1,
      transactionId: start[2].transactionId,
      meterValue: [
        {
          timestamp: '2026-09-28T08:30:00Z',
          sampledValue: [
            { value: '11.04', measurand: 'Power.Active.Import', unit: 'kW' },
            { value: '125500', measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
            { value: '3.7', measurand: 'Power.Active.Import', phase: 'L1', unit: 'kW' },
            { value: '64', measurand: 'SoC' },
          ],
        },
      ],
    })
    const d = ocppDriver(profile, server, 'EVC-01')
    expect(await d.read()).toEqual({
      p_kw: -11.04, // a load, in the site's sign convention
      e_in_kwh: 125.5,
      soc_pct: 64,
      state: 'charging',
      fault: [],
      session: { id: String(start[2].transactionId), idTag: 'BUS-7', kwh: 5.5, startedAt: '2026-09-28T08:00:00.000Z' },
    })
    expect(server.get('EVC-01')).toMatchObject({ vendor: 'Wallbox', model: 'Pulsar Plus', connected: true })
    await c.send('StatusNotification', { connectorId: 1, errorCode: 'GroundFailure', status: 'Faulted' })
    await c.send('StopTransaction', { transactionId: start[2].transactionId, meterStop: 126_000, timestamp: '2026-09-28T08:40:00Z' })
    expect(await d.read()).toMatchObject({ state: 'fault', fault: [{ code: 'GroundFailure', text: 'Ground failure' }], e_in_kwh: 126 })
    expect(await c.send('FirmwareStatusNotification', { status: 'Idle' })).toEqual([4, 'EVC-01-7', 'NotImplemented', 'FirmwareStatusNotification is not supported', {}])
    c.ws.close()
  })

  it('turns away a charger without the password or at another path', async () => {
    await expect(charger('EVC-02', undefined, 'wrong')).rejects.toThrow('401')
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/somewhere/EVC-02`, 'ocpp1.6')
      ws.once('open', resolve)
      ws.once('error', reject)
    })).rejects.toThrow()
  })
})

describe('commands to chargers', () => {
  it('limits the current until the end time, then clears only its own profile', async () => {
    const c = await charger('EVC-03')
    const d = ocppDriver(profile, server, 'EVC-03')
    const until = '2026-09-28T12:00:00.000Z'
    const undo = await d.write('limit_current', { amps: 16, until }, profile.write.limit_current, Date.parse(until))
    expect(c.received[0]).toEqual({
      action: 'SetChargingProfile',
      payload: {
        connectorId: 1,
        csChargingProfiles: { chargingProfileId: 1, stackLevel: 1, chargingProfilePurpose: 'TxDefaultProfile', chargingProfileKind: 'Relative', validTo: until, chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }] } },
      },
    })
    expect(await d.read()).toMatchObject({ limit_a: 16 })
    await d.undo('limit_current', undo, profile.write.limit_current)
    expect(c.received[1]).toEqual({ action: 'ClearChargingProfile', payload: { id: 1 } })
    expect(await d.read()).not.toHaveProperty('limit_a')
    c.ws.close()
  })

  it('sends a schedule as absolute periods from its first step', async () => {
    const c = await charger('EVC-04')
    const d = ocppDriver(profile, server, 'EVC-04')
    await d.write('set_charging_profile', { schedule: [{ start: '2026-09-28T19:15:00Z', limitA: 0 }, { start: '2026-09-29T04:00:00Z', limitA: 32 }], validTo: '2026-09-29T07:00:00Z' }, profile.write.set_charging_profile, null)
    expect(c.received[0].payload).toMatchObject({
      csChargingProfiles: { chargingProfileKind: 'Absolute', validTo: '2026-09-29T07:00:00Z', chargingSchedule: { startSchedule: '2026-09-28T19:15:00.000Z', chargingSchedulePeriod: [{ startPeriod: 0, limit: 0 }, { startPeriod: 31_500, limit: 32 }] } },
    })
    await expect(d.write('set_charging_profile', { schedule: [] }, profile.write.set_charging_profile, null)).rejects.toThrow('empty')
    c.ws.close()
  })

  it('says when the charger refuses, isn’t there, or has no session to stop', async () => {
    const c = await charger('EVC-05', (action) => ({ status: action === 'Reset' ? 'Rejected' : 'Accepted' }))
    const d = ocppDriver(profile, server, 'EVC-05')
    await expect(d.write('reset', {}, profile.write.reset, null)).rejects.toThrow('The charger answered reset with Rejected')
    await expect(d.write('remote_stop', {}, profile.write.remote_stop, null)).rejects.toThrow('No session is running')
    expect(await d.write('change_availability', { operative: false }, profile.write.change_availability, null)).toEqual({ operative: true })
    await expect(d.write('fly', {}, profile.write.reset, null)).rejects.toThrow('not something this charger can do')
    c.ws.close()
    await new Promise((r) => setTimeout(r, 50))
    await expect(d.read()).rejects.toThrow('not connected')
    await expect(ocppDriver(profile, server, 'EVC-99').write('reset', {}, profile.write.reset, null)).rejects.toThrow('not connected')
  })
})
