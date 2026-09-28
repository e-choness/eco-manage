/**
 * P5-04: the gateway against a SunSpec inverter and a CT meter over Modbus TCP (fakes on
 * localhost): finding them, reading them from their profiles, and a limit written and undone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getProfile } from '@ecomanage/profiles'
import { FakeModbus, fakeInverter, fakeMeter } from '../bench/fakeDevices'
import { gatewayConfig } from '../config'
import { modbusDriver } from '../drivers/modbus'
import { closeModbus, modbusIO } from '../modbus/link'
import { expandHosts, readSunSpec, scan, sunSpecFound } from '../scan'

const INV_PORT = 15020 + Math.floor(Math.random() * 500)
const METER_PORT = INV_PORT + 600
const inverterBox = new FakeModbus(INV_PORT)
const meterBox = new FakeModbus(METER_PORT, 1)
const inverter = fakeInverter(inverterBox)
const meter = fakeMeter(meterBox)
const tcp = (port: number, unitId = 1) => modbusIO({ kind: 'tcp', host: '127.0.0.1', port, unitId, timeoutMs: 1000 })

beforeAll(async () => {
  await Promise.all([inverterBox.start(), meterBox.start()])
  inverter.produce(8420, 12_345_678)
  meter.measure(-3150.5, 40_210.5, 12_004.25)
})

afterAll(async () => {
  closeModbus()
  await Promise.all([inverterBox.close(), meterBox.close()])
})

describe('finding devices', () => {
  it('reads the SunSpec marker, maker and models, and picks the inverter profile', async () => {
    const s = await readSunSpec(tcp(INV_PORT))
    expect(s).toEqual({ maker: 'Fronius', model: 'Symo 10.0-3-M', models: [1, 103] })
    expect(sunSpecFound('TCP · 127.0.0.1:502 · id 1', s!)).toEqual({ address: 'TCP · 127.0.0.1:502 · id 1', modelCode: 'Symo 10.0-3-M', profileId: 'sunspec-inverter@3', type: 'pv', name: 'Fronius Symo 10.0-3-M' })
    expect(sunSpecFound('x', { maker: 'Acme', model: 'Meter', models: [1, 203] })).toBeNull()
    expect(sunSpecFound('x', { maker: '', model: '', models: [1, 802] })).toMatchObject({ profileId: 'sunspec-storage-802@2', type: 'battery', name: 'SunSpec battery' })
  })

  it('isn’t fooled by a device without the marker', async () => {
    expect(await readSunSpec(tcp(METER_PORT))).toBeNull()
  })

  it('scans the configured hosts, skipping what the gateway already has', async () => {
    const cfg = gatewayConfig.parse({ mqttUrl: 'mqtts://broker:8883', bootstrap: { cert: 'c', key: 'k', ca: 'a' }, scan: { tcp: ['127.0.0.1', '127.0.0.2'], tcpPort: INV_PORT } })
    const chargers = [{ id: 'EVC-01', connected: true, vendor: 'Wallbox', model: 'Pulsar Plus', status: 'Available', errorCode: 'NoError', meter: {}, transaction: null, lastSeenAt: null }]
    const found = await scan(cfg, { chargers: () => chargers, known: () => false })
    expect(found).toEqual([
      { address: `TCP · 127.0.0.1:${INV_PORT} · id 1`, modelCode: 'Symo 10.0-3-M', profileId: 'sunspec-inverter@3', type: 'pv', name: 'Fronius Symo 10.0-3-M' },
      { address: 'OCPP · EVC-01', modelCode: 'Pulsar Plus', profileId: 'ocpp16-generic@1', type: 'ev', name: 'Wallbox Pulsar Plus' },
    ])
    expect(await scan(cfg, { chargers: () => chargers, known: (a) => a.startsWith('TCP') })).toHaveLength(1)
    expect(expandHosts(['192.168.1.0/24', ' 10.0.0.5 '])).toHaveLength(255)
  })
})

describe('reading from the profile', () => {
  it('gives the inverter’s power, energy and state', async () => {
    const d = modbusDriver(getProfile('sunspec-inverter@3')!, tcp(INV_PORT))
    expect(await d.read()).toEqual({ p_kw: 8.42, e_out_kwh: 12_345.678, a: [12.2], v: [230.1], hz: 50, pf: 1, t_c: 41.2, state: 'running', fault: [] })
  })

  it('gives the meter’s floats from input registers', async () => {
    const d = modbusDriver(getProfile('ct-meter-3ph@2')!, tcp(METER_PORT))
    expect(await d.read()).toMatchObject({ p_kw: -3.1505, e_in_kwh: 40_210.5, e_out_kwh: 12_004.25, hz: 50, v: [expect.closeTo(231.2, 3)] })
  })

  it('fails when the device isn’t there', async () => {
    await expect(modbusDriver(getProfile('ct-meter-3ph@2')!, tcp(METER_PORT + 1)).read()).rejects.toThrow()
  })

  it('reads a device documented from 1 with an offset', async () => {
    const shifted = new FakeModbus(INV_PORT + 1200)
    fakeInverter(shifted).produce(1000, 5)
    // Everything one register later than the profile says.
    for (const [a, w] of [...shifted.holding]) shifted.holding.set(a + 1, w)
    await shifted.start()
    expect(await modbusDriver(getProfile('sunspec-inverter@3')!, tcp(shifted.port), 1).read()).toMatchObject({ p_kw: 1 })
    await shifted.close()
  })
})

describe('writing a limit', () => {
  it('writes it with the device’s own revert timeout, and puts back what was there', async () => {
    const profile = getProfile('sunspec-inverter@3')!
    const d = modbusDriver(profile, tcp(INV_PORT))
    inverterBox.writes.length = 0
    const undo = await d.write('export_limit', { pct: 60, until: new Date(Date.now() + 600_000).toISOString() }, profile.write.export_limit, Date.now() + 600_000)
    expect(inverterBox.holding.get(40232)).toBe(60)
    expect(inverterBox.holding.get(40235)).toBeGreaterThanOrEqual(599)
    expect(undo).toEqual({ reg: 40232, words: [100] })
    await d.undo('export_limit', undo, profile.write.export_limit)
    expect(inverterBox.holding.get(40232)).toBe(100)
  })

  it('triggers a restart without anything to undo', async () => {
    const profile = getProfile('sunspec-inverter@3')!
    const d = modbusDriver(profile, tcp(INV_PORT))
    expect(await d.write('restart', {}, profile.write.restart, null)).toBeNull()
    expect(inverterBox.holding.get(40250)).toBe(1)
    await expect(d.write('nope', { x: 1 }, { description: '', params: {} }, null)).rejects.toThrow('has no register')
  })
})
