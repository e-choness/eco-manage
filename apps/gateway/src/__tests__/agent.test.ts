/**
 * P5-04: the agent between its devices and the cloud — readings sent or kept and resent in
 * order, status, commands and jobs from MQTT, and commissioning with its checks. The devices are
 * the Modbus fakes; the cloud link is a stand-in that can go away.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { topics } from '@ecomanage/shared'
import { Agent, type Link } from '../agent'
import { FakeModbus, fakeInverter, fakeMeter } from '../bench/fakeDevices'
import { gatewayConfig, rtuAddress, tcpAddress } from '../config'
import { closeModbus } from '../modbus/link'
import { Store } from '../store'

const SITE = '650000000000000000000001'
const PORT = 17020 + Math.floor(Math.random() * 400)
const inverterBox = new FakeModbus(PORT)
const meterBox = new FakeModbus(PORT + 500)
const inverter = fakeInverter(inverterBox)
const meter = fakeMeter(meterBox)
const log = { info: () => undefined, warn: () => undefined }

// The cloud: records what was published; `up` is whether the connection is there.
class FakeLink implements Link {
  up = true
  sent: { topic: string; payload: unknown; retain: boolean }[] = []
  readonly siteId = SITE
  online() {
    return this.up
  }
  async publish(topic: string, payload: unknown, retain = false) {
    if (!this.up) return false
    this.sent.push({ topic, payload, retain })
    return true
  }
}

const cfg = gatewayConfig.parse({
  mqttUrl: 'mqtts://broker:8883',
  bootstrap: { cert: 'c', key: 'k', ca: 'a' },
  scan: { tcp: ['127.0.0.1'], tcpPort: PORT },
  ocpp: null,
  devices: [{ id: 'meter-1', profileId: 'ct-meter-3ph@2', type: 'meter', address: 'bench meter', modbus: { host: '127.0.0.1', port: PORT + 500, unitId: 1 } }],
})

let link: FakeLink
let store: Store
let agent: Agent

beforeAll(async () => {
  await Promise.all([inverterBox.start(), meterBox.start()])
})

afterAll(async () => {
  closeModbus()
  await Promise.all([inverterBox.close(), meterBox.close()])
})

beforeEach(() => {
  inverter.produce(8000, 1_000_000)
  meter.measure(20_000, 500) // importing 20 kW
  link = new FakeLink()
  store = new Store()
  agent = new Agent({ cfg, store, link, log, exit: () => undefined })
  agent.loadDevices()
})

describe('readings', () => {
  it('sends a reading straight away while the cloud is there', async () => {
    const r = await agent.poll(agent.running('meter-1')!)
    expect(r).toMatchObject({ p_kw: 20, e_in_kwh: 500, q: 'ok' })
    expect(link.sent).toEqual([{ topic: topics.telemetry(SITE, 'meter-1'), payload: r, retain: false }])
  })

  it('keeps readings while it is away and resends them first, in order, when it is back', async () => {
    link.up = false
    for (const kw of [10, 11, 12]) {
      meter.measure(kw * 1000, 500)
      await agent.poll(agent.running('meter-1')!)
    }
    expect(store.count()).toBe(3)
    link.up = true
    meter.measure(13_000, 500)
    await agent.poll(agent.running('meter-1')!) // queued behind the backlog
    expect(link.sent).toEqual([])
    expect(await agent.flush()).toBe(4)
    expect(link.sent).toHaveLength(1)
    expect((link.sent[0].payload as { items: { p_kw: number }[] }).items.map((i) => i.p_kw)).toEqual([10, 11, 12, 13])
    expect(store.count()).toBe(0)
  })

  it('reports the backlog in its status, and says when a device stops answering', async () => {
    link.up = false
    await agent.poll(agent.running('meter-1')!)
    link.up = true
    await agent.publishStatus()
    expect(link.sent[0]).toMatchObject({ topic: topics.gatewayStatus(SITE), retain: true, payload: { fw: '0.1.0', buffered: 1, oldestBufferedTs: expect.any(String), clockOffsetMs: 0 } })

    const ghost = agent.addDevice({ id: 'ghost', profileId: 'ct-meter-3ph@2', type: 'meter', address: '', regOffset: 0, modbus: { host: '127.0.0.1', port: PORT + 499, unitId: 1 } }, false)!
    for (let i = 0; i < 3; i++) expect(await agent.poll(ghost)).toBeNull()
    expect(link.sent.at(-1)).toMatchObject({ topic: topics.deviceStatus(SITE, 'ghost'), payload: { state: 'no response', fault: [{ code: 'no-response' }] } })
  })
})

describe('messages from the cloud', () => {
  it('keeps the battery floor, answers commands and ignores other sites', async () => {
    await agent.handle(topics.gatewayConfig(SITE), { ts: new Date().toISOString(), batteryFloorPct: 30 })
    expect(agent.commands.floorPct()).toBe(30)
    await agent.handle(topics.command(SITE, 'c1'), { deviceId: 'meter-1', action: 'restart', params: {}, expiresAt: new Date(Date.now() + 60_000).toISOString(), revertAt: null })
    expect(link.sent).toEqual([{ topic: topics.commandAck(SITE, 'c1'), payload: { ok: false, ts: expect.any(String), error: 'action restart is not supported' }, retain: false }])
    await agent.handle(topics.command('650000000000000000000009', 'c2'), {})
    await agent.handle('not/ours', {})
    expect(link.sent).toHaveLength(1)
  })

  it('restarts when asked, after saying so', async () => {
    let exited = false
    const a = new Agent({ cfg, store, link, log, exit: () => (exited = true) })
    await a.handle(topics.job(SITE, 'j1'), { type: 'restart', params: {} })
    expect(link.sent[0]).toMatchObject({ topic: topics.jobResult(SITE, 'j1'), payload: { ok: true } })
    await new Promise((r) => setTimeout(r, 1100))
    expect(exited).toBe(true)
    await a.handle(topics.job(SITE, 'j2'), { type: 'dance' })
    expect(link.sent[1].payload).toMatchObject({ ok: false, error: 'malformed job' })
  })
})

describe('scan and commission (Data and Device Audit §4)', () => {
  it('finds the inverter, commissions it with its checks and polls it from then on', async () => {
    await agent.poll(agent.running('meter-1')!) // the meter's reading, for the balance
    await agent.handle(topics.job(SITE, 'scan-1'), { type: 'scan', params: {} })
    const address = tcpAddress('127.0.0.1', PORT, 1)
    expect(link.sent.at(-1)!.payload).toMatchObject({ ok: true, data: { found: [{ address, profileId: 'sunspec-inverter@3', type: 'pv', name: 'Fronius Symo 10.0-3-M' }] } })

    await agent.handle(topics.job(SITE, 'com-1'), { type: 'commission', params: { deviceId: 'inv-1', address } })
    expect(link.sent.at(-1)!.payload).toMatchObject({
      ok: true,
      data: { checks: [{ name: 'Live read', pass: true }, { name: 'Sign check: production positive', pass: true }, { name: 'Energy balance within 5%', pass: true }] },
    })
    expect(store.devices()).toEqual([expect.objectContaining({ id: 'inv-1', profileId: 'sunspec-inverter@3', address, modbus: { host: '127.0.0.1', port: PORT, unitId: 1 } })])
    // Known now: a second scan doesn't offer it again.
    await agent.handle(topics.job(SITE, 'scan-2'), { type: 'scan', params: {} })
    expect(link.sent.at(-1)!.payload).toMatchObject({ data: { found: [] } })
    agent.stop()
  })

  it('fails a device that reads backwards, and anything it didn’t just find', async () => {
    await agent.poll(agent.running('meter-1')!)
    store.set('lastScan', [{ address: rtuAddress('/dev/ttyUSB0', 7), modelCode: '', profileId: 'ct-meter-3ph@2', type: 'submeter', name: 'Kitchen' }])
    await agent.handle(topics.job(SITE, 'com-2'), { type: 'commission', params: { deviceId: 'sub-1', address: 'TCP · 10.0.0.9:502 · id 1' } })
    expect(link.sent.at(-1)!.payload).toMatchObject({ ok: false, error: 'Nothing to commission at that address. Scan again first.' })

    // A meter wired the wrong way: it says the site exports 20 kW while the inverter makes 8.
    const r = agent.addDevice({ id: 'inv-2', profileId: 'sunspec-inverter@3', type: 'pv', address: '', regOffset: 0, modbus: { host: '127.0.0.1', port: PORT, unitId: 1 } }, false)!
    const reading = await agent.poll(r)
    meter.measure(-20_000, 500)
    await agent.poll(agent.running('meter-1')!)
    expect(agent.checks(agent.running('meter-1')!, agent.running('meter-1')!.latest)).toEqual([
      { name: 'Live read', pass: true },
      { name: 'Sign check: import positive', pass: false },
      { name: 'Energy balance within 5%', pass: false },
    ])
    expect(agent.checks(r, reading)[1]).toEqual({ name: 'Sign check: production positive', pass: true })
    expect(agent.checks(r, null)).toEqual([{ name: 'Live read', pass: false }])
    agent.stop()
  })

  it('reads a CT meter used as a sub-meter as a load', async () => {
    const sub = agent.addDevice({ id: 'sub-2', profileId: 'ct-meter-3ph@2', type: 'submeter', address: '', regOffset: 0, modbus: { host: '127.0.0.1', port: PORT + 500, unitId: 1 } }, false)!
    meter.measure(4200, 12)
    expect(await agent.poll(sub)).toMatchObject({ p_kw: -4.2 })
    expect(agent.checks(sub, sub.latest)[1]).toEqual({ name: 'Sign check: a load reads negative', pass: true })
    agent.stop()
  })
})
