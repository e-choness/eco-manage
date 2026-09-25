/**
 * P2-07: findings → alerts against the compose MongoDB, and the service publishing alert events
 * on the site channel (Redis DB 7).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Redis } from 'ioredis'
import pino from 'pino'
import { Alert, Device, RuleMute, Site, initModels } from '@ecomanage/db'
import { alertKey, siteEventsChannel, type CheckResult, type Finding } from '@ecomanage/shared'
import { reconcile } from '../reconcile'
import { RulesService } from '../service'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_rules`
const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/7') || 'redis://redis:6379/7'
const siteId = new mongoose.Types.ObjectId()
const sid = String(siteId)
const T = (min: number) => new Date(Date.parse('2026-09-24T18:00:00Z') + min * 60_000)

const silent = (deviceId: string): Finding => ({ ruleId: 'device-silent', deviceId, detail: `${deviceId}: no data` })
const failed = (deviceId: string, eventKey: string): Finding => ({ ruleId: 'command-failed', deviceId, detail: `${deviceId}: failed`, eventKey })
const run = (findings: Finding[], evaluated: string[] = findings.map((f) => alertKey(f.ruleId, f.deviceId))): CheckResult => ({ findings, evaluated })

let redis: Redis

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  redis = new Redis(REDIS)
  await redis.flushdb()
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  await redis.flushdb()
  redis.disconnect()
})

beforeEach(async () => {
  await Promise.all([Alert.deleteMany({}), RuleMute.deleteMany({}), Site.deleteMany({}), Device.deleteMany({})])
})

describe('condition alerts', () => {
  it('opens one alert per (device, rule) and keeps it fresh while the condition holds', async () => {
    const opened = await reconcile(sid, run([silent('ev3'), silent('ev4')]), T(0))
    expect(opened.map((a) => [a.deviceId, a.state, a.condition, a.severity, a.title])).toEqual([
      ['ev3', 'open', 'active', 'warning', 'Device not reporting'],
      ['ev4', 'open', 'active', 'warning', 'Device not reporting'],
    ])
    expect(await reconcile(sid, run([silent('ev3'), silent('ev4')]), T(1))).toEqual([])
    const alerts = await Alert.find({ siteId }).lean()
    expect(alerts).toHaveLength(2)
    expect(alerts[0].lastSeenAt).toEqual(T(1))
  })

  it('resolves itself when its check runs and the condition is gone, not when the check cannot run', async () => {
    await reconcile(sid, run([silent('ev3'), silent('ev4')]), T(0))
    // ev4 not evaluated (e.g. no data to judge): stays open
    const changed = await reconcile(sid, run([], [alertKey('device-silent', 'ev3')]), T(2))
    expect(changed.map((a) => [a.deviceId, a.state, a.condition])).toEqual([['ev3', 'resolved', 'cleared']])
    const ev3 = await Alert.findOne({ deviceId: 'ev3' }).lean()
    expect(ev3).toMatchObject({ resolvedAt: T(2), resolution: { cause: 'Condition cleared', auto: true } })
    expect(await Alert.countDocuments({ state: 'open' })).toBe(1)
  })

  it('resolves acknowledged alerts too, and opens a new one if it comes back', async () => {
    await reconcile(sid, run([silent('ev3')]), T(0))
    await Alert.updateOne({ deviceId: 'ev3' }, { $set: { state: 'ack' } })
    await reconcile(sid, run([], [alertKey('device-silent', 'ev3')]), T(1))
    const again = await reconcile(sid, run([silent('ev3')]), T(5))
    expect(again).toEqual([expect.objectContaining({ state: 'open', openedAt: T(5).toISOString() })])
    expect(await Alert.countDocuments({ deviceId: 'ev3' })).toBe(2)
  })

  it('stays single when two rules processes race', async () => {
    await Promise.all([reconcile(sid, run([silent('ev3')]), T(0)), reconcile(sid, run([silent('ev3')]), T(0))])
    expect(await Alert.countDocuments({ deviceId: 'ev3', state: 'open' })).toBe(1)
  })
})

describe('mutes', () => {
  it('stop new alerts for the rule and device until they end', async () => {
    await RuleMute.create({ siteId, deviceId: 'ev3', ruleId: 'device-silent', until: T(60) })
    expect(await reconcile(sid, run([silent('ev3'), silent('ev4')]), T(0))).toEqual([expect.objectContaining({ deviceId: 'ev4' })])
    expect(await reconcile(sid, run([silent('ev3')]), T(61))).toEqual([expect.objectContaining({ deviceId: 'ev3' })])
  })

  it('can mute a rule for the whole site', async () => {
    await RuleMute.create({ siteId, deviceId: null, ruleId: 'device-silent', until: T(60) })
    expect(await reconcile(sid, run([silent('ev3'), silent('ev4')]), T(0))).toEqual([])
  })
})

describe('event alerts (failed commands)', () => {
  it('open without an active condition, count each new occurrence once, and never resolve themselves', async () => {
    const [a] = await reconcile(sid, run([failed('bat', 'c1')], []), T(0))
    expect(a).toMatchObject({ ruleId: 'command-failed', state: 'open', condition: 'cleared', count: 1 })
    expect(await reconcile(sid, run([failed('bat', 'c1')], []), T(1))).toEqual([])
    expect(await reconcile(sid, run([failed('bat', 'c1'), failed('bat', 'c2')], []), T(2))).toEqual([expect.objectContaining({ count: 2 })])
    expect(await reconcile(sid, run([], [alertKey('command-failed', 'bat')]), T(3))).toEqual([])
    expect(await Alert.countDocuments({ state: 'open' })).toBe(1)
  })

  it('do not come back for an occurrence someone resolved', async () => {
    await reconcile(sid, run([failed('bat', 'c1')], []), T(0))
    await Alert.updateMany({}, { $set: { state: 'resolved' } })
    expect(await reconcile(sid, run([failed('bat', 'c1')], []), T(1))).toEqual([])
    expect(await reconcile(sid, run([failed('bat', 'c3')], []), T(2))).toEqual([expect.objectContaining({ count: 1, state: 'open' })])
  })
})

describe('RulesService', () => {
  it('evaluates a site from its stored state and publishes the alert on the site channel', async () => {
    const now = new Date()
    await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', demandCapKw: 120 })
    const ev3 = await Device.create({ siteId, type: 'ev', name: 'EV charger 3', status: 'offline', lastSeenAt: new Date(now.getTime() - 10 * 60_000) })
    const sub = redis.duplicate()
    const events: unknown[] = []
    await sub.subscribe(siteEventsChannel(sid))
    sub.on('message', (_c, m) => events.push(JSON.parse(m)))
    const rules = new RulesService({ redis, logger: pino({ level: 'silent' }) })

    const changed = await rules.evaluate(sid, now)
    expect(changed).toEqual([expect.objectContaining({ ruleId: 'device-silent', deviceId: String(ev3._id), detail: 'EV charger 3: no data for 10 min' })])
    await new Promise((r) => setTimeout(r, 100))
    expect(events).toEqual([{ type: 'alert', alert: expect.objectContaining({ ruleId: 'device-silent', state: 'open' }) }])

    // New readings mark the site; the charger reports again and the alert closes.
    await Device.updateOne({ _id: ev3._id }, { $set: { lastSeenAt: now, status: 'live' } })
    rules.onEvent(sid, { type: 'device', deviceId: String(ev3._id), status: 'live' })
    await rules.runDirty(new Date(now.getTime() + 5000))
    await new Promise((r) => setTimeout(r, 100))
    expect(events.at(-1)).toEqual({ type: 'alert', alert: expect.objectContaining({ state: 'resolved' }) })
    sub.disconnect()
  })

  it('ignores its own alert events and remembers demand from ingest', async () => {
    const rules = new RulesService({ redis, logger: pino({ level: 'silent' }) })
    const now = new Date()
    const start = new Date(Math.floor(now.getTime() / 900_000) * 900_000)
    await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', demandCapKw: 120 })
    rules.onEvent(sid, { type: 'alert', alert: {} as never })
    rules.onEvent(sid, { type: 'demand', demand: { intervalStart: start.toISOString(), soFarKw: 100, projectedKw: 115 }, quality: 'ok' })
    const changed = await rules.evaluate(sid, now)
    expect(changed).toEqual([expect.objectContaining({ ruleId: 'demand-near-cap', deviceId: null })])
  })
})
