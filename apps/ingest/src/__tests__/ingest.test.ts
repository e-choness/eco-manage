/**
 * P1-06 acceptance, against real MongoDB and Redis: validation against the profile, dedupe on
 * (deviceId, ts), backfill flag, a 7-day buffered replay ingested in order with no duplicates,
 * at least 50 messages/s per site, and stale/offline marking.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Redis } from 'ioredis'
import pino from 'pino'
import { Command, Device, Telemetry, initModels } from '@ecomanage/db'
import { DEMO_DEVICES, DEMO_SITE_ID, topics, type TelemetryReading } from '@ecomanage/shared'
import { Ingestor, keys } from '../ingestor'
import { markSilentDevices } from '../stale'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_ingest`
const REDIS = process.env.REDIS_TEST_URL || 'redis://redis:6379/2'
const log = pino({ level: 'silent' })
const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!
const OTHER_SITE = '650000000000000000000099'
const FOREIGN_DEVICE = '650000000000000000009901'

let redis: Redis
let ingestor: Ingestor

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  redis = new Redis(REDIS)
})

afterAll(async () => {
  await redis.flushdb()
  await redis.quit()
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await redis.flushdb()
  await Promise.all([Telemetry.deleteMany({}), Device.deleteMany({})])
  await Device.insertMany([
    ...DEMO_DEVICES.map((d) => ({ _id: d.id, siteId: DEMO_SITE_ID, type: d.type, name: d.name, profileId: d.profileId, status: 'live' })),
    { _id: FOREIGN_DEVICE, siteId: OTHER_SITE, type: 'meter', name: 'Other meter', profileId: 'ct-meter-3ph@2', status: 'live' },
  ])
  ingestor = new Ingestor({ redis, logger: log, flushMs: 0 })
})

const meterReading = (ts: string, eIn = 1000, pKw = 12.8): TelemetryReading => ({ ts, p_kw: pKw, e_in_kwh: eIn, e_out_kwh: 50, q: 'ok' })
const send = (key: string, payload: unknown, receivedAt = new Date('2026-09-24T16:40:05Z'), site = DEMO_SITE_ID, id = dev(key).id) =>
  ingestor.handle(topics.telemetry(site, id), JSON.stringify(payload), receivedAt)

describe('one reading', () => {
  it('is stored with its metadata, becomes the latest value, and marks the device as seen', async () => {
    await Device.updateOne({ _id: dev('meter').id }, { status: 'stale' })
    await send('meter', meterReading('2026-09-24T16:40:03Z'))
    await ingestor.flush()

    const rows = await Telemetry.find().lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ p_kw: 12.8, e_in_kwh: 1000, q: 'ok' })
    expect(String(rows[0].meta?.deviceId)).toBe(dev('meter').id)
    expect(String(rows[0].meta?.siteId)).toBe(DEMO_SITE_ID)

    expect(JSON.parse((await redis.get(keys.latest(dev('meter').id)))!)).toMatchObject({ ts: '2026-09-24T16:40:03Z', p_kw: 12.8 })
    const device = await Device.findById(dev('meter').id).lean()
    expect(device?.status).toBe('live')
    expect(device?.lastSeenAt?.toISOString()).toBe('2026-09-24T16:40:05.000Z')
  })

  it('keeps the newest reading as latest when an older one arrives later', async () => {
    await send('meter', meterReading('2026-09-24T16:40:10Z', 1001))
    await send('meter', meterReading('2026-09-24T16:40:05Z', 1000))
    expect(JSON.parse((await redis.get(keys.latest(dev('meter').id)))!).ts).toBe('2026-09-24T16:40:10Z')
  })

  it('does not bring a pending (uncommissioned) device live', async () => {
    await Device.updateOne({ _id: dev('meter').id }, { status: 'pending' })
    await send('meter', meterReading('2026-09-24T16:40:03Z'))
    await ingestor.flush()
    expect((await Device.findById(dev('meter').id).lean())?.status).toBe('pending')
  })
})

describe('validation', () => {
  it('rejects bad JSON, bad payloads, unknown devices, other sites and fields the profile lacks', async () => {
    await ingestor.handle(topics.telemetry(DEMO_SITE_ID, dev('meter').id), '{nope', new Date())
    await send('meter', { ts: 'yesterday', p_kw: 1 })
    await send('meter', meterReading('2026-09-24T16:40:03Z'), undefined, DEMO_SITE_ID, '650000000000000000000999')
    await send('meter', meterReading('2026-09-24T16:40:03Z'), undefined, DEMO_SITE_ID, FOREIGN_DEVICE)
    await send('meter', { ...meterReading('2026-09-24T16:40:03Z'), soc_pct: 50 })
    await ingestor.flush()

    expect(ingestor.stats.rejected).toEqual({
      'not-json': 1,
      'invalid-payload': 1,
      'unknown-device': 1,
      'wrong-site': 1,
      'undeclared-fields': 1,
    })
    expect(await Telemetry.countDocuments()).toBe(0)
  })

  it('ignores topics that are not telemetry for ingest', async () => {
    await ingestor.handle('something/else', '{}')
    await ingestor.handle(topics.commandAck(DEMO_SITE_ID, 'c1'), JSON.stringify({ ok: true, ts: '2026-09-24T16:40:03Z' }))
    expect(ingestor.stats.received).toBe(0)
  })

  it('keeps gateway and device status in Redis', async () => {
    const gw = { ts: '2026-09-24T16:40:03Z', fw: '1.4.2', uptimeS: 10, buffered: 0, oldestBufferedTs: null, clockOffsetMs: 0 }
    await ingestor.handle(topics.gatewayStatus(DEMO_SITE_ID), JSON.stringify(gw), new Date('2026-09-24T16:40:04Z'))
    await ingestor.handle(topics.deviceStatus(DEMO_SITE_ID, dev('ev3').id), JSON.stringify({ ts: gw.ts, state: 'Faulted' }))
    expect(JSON.parse((await redis.get(keys.gateway(DEMO_SITE_ID)))!)).toMatchObject({ fw: '1.4.2', receivedAt: '2026-09-24T16:40:04.000Z' })
    expect(JSON.parse((await redis.get(keys.deviceStatus(dev('ev3').id)))!)).toMatchObject({ state: 'Faulted', fault: [] })
  })
})

describe('backfill and duplicates', () => {
  it('marks readings that arrive more than 15 minutes late as backfilled', async () => {
    await send('meter', meterReading('2026-09-24T16:00:00Z'), new Date('2026-09-24T16:20:00Z'))
    await send('meter', meterReading('2026-09-24T16:10:00Z'), new Date('2026-09-24T16:20:00Z'))
    await ingestor.flush()
    const q = (await Telemetry.find().sort({ ts: 1 }).lean()).map((r) => r.q)
    expect(q).toEqual(['backfilled', 'ok'])
  })

  it('stores a resent reading once', async () => {
    const r = meterReading('2026-09-24T16:40:03Z')
    await send('meter', r)
    await send('meter', r)
    await send('meter', { items: [r, meterReading('2026-09-24T16:40:08Z')] })
    await ingestor.flush()
    expect(await Telemetry.countDocuments()).toBe(2)
    expect(ingestor.stats.duplicates).toBe(2)
  })

  it('ingests a 7-day buffered replay in order with no duplicates', async () => {
    const start = Date.parse('2026-09-17T16:00:00Z')
    const total = 7 * 24 * 720 // one reading every 5 s
    const readings = Array.from({ length: total }, (_, i) => meterReading(new Date(start + i * 5000).toISOString(), 1000 + i * 0.01))
    const reconnect = new Date(start + total * 5000 + 1000)
    const replay = async () => {
      for (let i = 0; i < total; i += 500) await send('meter', { items: readings.slice(i, i + 500) }, reconnect)
      await ingestor.flush()
    }

    await replay()
    // The gateway resends everything after a second drop; nothing may be stored twice.
    await replay()

    expect(await Telemetry.countDocuments()).toBe(total)
    expect(ingestor.stats.duplicates).toBe(total)
    const stored = await Telemetry.find().sort({ ts: 1 }).select('ts e_in_kwh q').lean()
    const distinct = new Set(stored.map((r) => r.ts.getTime()))
    expect(distinct.size).toBe(total)
    expect(stored[0].ts.toISOString()).toBe('2026-09-17T16:00:00.000Z')
    expect(stored.every((r, i) => i === 0 || r.e_in_kwh! > stored[i - 1].e_in_kwh!)).toBe(true)
    // Readings more than 15 min old at reconnect are backfill; the tail is not.
    const expected = (ts: Date) => (reconnect.getTime() - ts.getTime() > 15 * 60_000 ? 'backfilled' : 'ok')
    expect(stored.every((r) => r.q === expected(r.ts))).toBe(true)
    expect(stored.filter((r) => r.q === 'ok')).toHaveLength(179)
  })
})

describe('throughput', () => {
  it('handles well over 50 messages per second for one site', async () => {
    const keysToSend = ['invA', 'invB', 'bat', 'meter', 'ev1', 'ev2', 'ev3', 'ev4', 'hp']
    const perDevice = 300
    const t0 = performance.now()
    for (let i = 0; i < perDevice; i++) {
      const ts = new Date(Date.parse('2026-09-24T16:00:00Z') + i * 5000).toISOString()
      await Promise.all(keysToSend.map((k) => send(k, { ts, p_kw: k === 'hp' || k.startsWith('ev') ? -5 : 5, q: 'ok' }, new Date(ts))))
    }
    await ingestor.flush()
    const seconds = (performance.now() - t0) / 1000
    const rate = (perDevice * keysToSend.length) / seconds
    expect(await Telemetry.countDocuments()).toBe(perDevice * keysToSend.length)
    expect(rate).toBeGreaterThan(50)
    console.log(`ingest throughput: ${Math.round(rate)} msgs/s`)
  })
})

describe('silent devices', () => {
  it('marks devices stale after 60 s and offline after 5 min', async () => {
    const now = new Date('2026-09-24T16:40:00Z')
    await Device.updateOne({ _id: dev('invA').id }, { lastSeenAt: new Date(now.getTime() - 30_000) })
    await Device.updateOne({ _id: dev('ev3').id }, { lastSeenAt: new Date(now.getTime() - 90_000) })
    await Device.updateOne({ _id: dev('ev4').id }, { lastSeenAt: new Date(now.getTime() - 6 * 60_000) })
    await Device.updateMany({ _id: { $nin: [dev('invA').id, dev('ev3').id, dev('ev4').id] } }, { status: 'pending' })

    expect(await markSilentDevices(now)).toEqual({ stale: 1, offline: 1 })
    const status = async (k: string) => (await Device.findById(dev(k).id).lean())?.status
    expect(await status('invA')).toBe('live')
    expect(await status('ev3')).toBe('stale')
    expect(await status('ev4')).toBe('offline')
    expect(await status('meter')).toBe('pending')
  })
})

describe('command acks (P2-08)', () => {
  const sentCommand = (siteId = DEMO_SITE_ID) =>
    Command.create({ siteId, deviceId: dev('ev3').id, action: 'reset', expiresAt: new Date('2026-09-24T16:45:00Z'), status: 'sent', sentAt: new Date('2026-09-24T16:40:00Z') })
  const ackAt = new Date('2026-09-24T16:40:04Z')

  it('marks a sent command acked, or failed with the gateway’s error, and reports the change', async () => {
    const seen: unknown[][] = []
    const withCallback = new Ingestor({ redis, logger: log, flushMs: 0, onCommand: (...args) => seen.push(args) })
    const ok = await sentCommand()
    const bad = await sentCommand()
    await withCallback.handle(topics.commandAck(DEMO_SITE_ID, String(ok._id)), JSON.stringify({ ok: true, ts: ackAt.toISOString() }), ackAt)
    await withCallback.handle(topics.commandAck(DEMO_SITE_ID, String(bad._id)), JSON.stringify({ ok: false, error: 'rejected by device', ts: ackAt.toISOString() }), ackAt)
    expect(await Command.findById(ok._id).lean()).toMatchObject({ status: 'acked', ackedAt: ackAt })
    expect(await Command.findById(bad._id).lean()).toMatchObject({ status: 'failed', failedAt: ackAt, error: 'rejected by device' })
    expect(seen).toEqual([
      [DEMO_SITE_ID, String(ok._id), dev('ev3').id, 'acked'],
      [DEMO_SITE_ID, String(bad._id), dev('ev3').id, 'failed'],
    ])
    // A repeated ack changes nothing
    await withCallback.handle(topics.commandAck(DEMO_SITE_ID, String(bad._id)), JSON.stringify({ ok: true, ts: ackAt.toISOString() }), ackAt)
    expect((await Command.findById(bad._id).lean())!.status).toBe('failed')
    expect(seen).toHaveLength(2)
  })

  it('ignores acks from another site, for unknown ids, or malformed', async () => {
    const cmd = await sentCommand()
    await ingestor.handle(topics.commandAck(OTHER_SITE, String(cmd._id)), JSON.stringify({ ok: true, ts: ackAt.toISOString() }), ackAt)
    await ingestor.handle(topics.commandAck(DEMO_SITE_ID, 'not-an-id'), JSON.stringify({ ok: true, ts: ackAt.toISOString() }), ackAt)
    await ingestor.handle(topics.commandAck(DEMO_SITE_ID, String(cmd._id)), JSON.stringify({ ok: 'yes' }), ackAt)
    expect((await Command.findById(cmd._id).lean())!.status).toBe('sent')
    expect(ingestor.stats.rejected).toEqual({ 'unknown-command': 1, 'bad-ack': 1 })
  })
})
