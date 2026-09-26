/**
 * P3-04: commands from approval to revert. The acceptance runs against the simulated site: an
 * approved peak-shaving discharge goes out at the window start, the battery discharges, the command
 * is verified from telemetry and reverted at the window end. Acks are recorded as ingest does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Redis } from 'ioredis'
import pino from 'pino'
import { Command, Device, Recommendation, initModels, type CommandDoc } from '@ecomanage/db'
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, commandAckMessage, parseTopic, type CommandMessage, type TelemetryReading } from '@ecomanage/shared'
import { SiteEngine } from '@ecomanage/simulator/engine'
import { Gateway } from '@ecomanage/simulator/gateway'
import { CommandDispatcher } from '../commands/dispatcher'
import { followsCommand } from '../commands/verify'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_rules_commands`
const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/11') || 'redis://redis:6379/11'
const log = pino({ level: 'silent' })
const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!
const u = (iso: string) => new Date(iso)
const reading = (over: Partial<TelemetryReading>): TelemetryReading => ({ ts: '2026-09-24T18:00:00.000Z', p_kw: 0, q: 'ok', ...over })

let redis: Redis

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  redis = new Redis(REDIS)
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  await redis.flushdb()
  redis.disconnect()
})

beforeEach(async () => {
  await redis.flushdb()
  await Promise.all([Command.deleteMany({}), Recommendation.deleteMany({}), Device.deleteMany({})])
  await Device.insertMany(DEMO_DEVICES.map((d) => ({ _id: d.id, siteId: DEMO_SITE_ID, type: d.type, name: d.name, profileId: d.profileId, ratedKw: d.ratedKw, status: 'live' })))
})

describe('followsCommand', () => {
  const at = u('2026-09-24T18:30:00Z')
  it('reads each kind of command from telemetry', () => {
    expect(followsCommand({ action: 'force_discharge', params: { kw: 30 } }, { ratedKw: 60 }, reading({ p_kw: 29 }), at)).toBe('yes')
    expect(followsCommand({ action: 'force_discharge', params: { kw: 30 } }, { ratedKw: 60 }, reading({ p_kw: 10 }), at)).toBe('no')
    expect(followsCommand({ action: 'force_charge', params: { kw: 20 } }, { ratedKw: 60 }, reading({ p_kw: -19 }), at)).toBe('yes')
    expect(followsCommand({ action: 'set_reserve', params: { pct: 80 } }, { ratedKw: 60 }, reading({ reserve_pct: 80 }), at)).toBe('yes')
    expect(followsCommand({ action: 'set_reserve', params: { pct: 80 } }, { ratedKw: 60 }, reading({}), at)).toBe('wait')
    expect(followsCommand({ action: 'limit_current', params: { amps: 16 } }, { ratedKw: 22 }, reading({ p_kw: -11, limit_a: 16 }), at)).toBe('yes')
    expect(followsCommand({ action: 'limit_current', params: { amps: 16 } }, { ratedKw: 22 }, reading({ p_kw: -22 }), at)).toBe('no')
    const profile = { schedule: [{ start: '2026-09-24T18:00:00Z', limitA: 0 }, { start: '2026-09-25T04:00:00Z', limitA: 32 }] }
    expect(followsCommand({ action: 'set_charging_profile', params: profile }, { ratedKw: 22 }, reading({ p_kw: 0 }), at)).toBe('yes')
    expect(followsCommand({ action: 'set_charging_profile', params: profile }, { ratedKw: 22 }, reading({ p_kw: -22 }), at)).toBe('no')
    const hp = { schedule: [{ start: '2026-09-24T18:00:00Z', mode: 3 }, { start: '2026-09-24T19:00:00Z', mode: 1 }] }
    expect(followsCommand({ action: 'sg_schedule', params: hp }, { ratedKw: 40 }, reading({ sg_mode: 3 }), at)).toBe('yes')
    expect(followsCommand({ action: 'sg_schedule', params: hp }, { ratedKw: 40 }, reading({ sg_mode: 2 }), u('2026-09-24T17:00:00Z'))).toBe('wait')
    expect(followsCommand({ action: 'sg_mode', params: { mode: 1 } }, { ratedKw: 40 }, reading({ sg_mode: 2 }), at)).toBe('no')
    expect(followsCommand({ action: 'export_limit', params: { pct: 20 } }, { ratedKw: 50 }, reading({ p_kw: 9.8 }), at)).toBe('yes')
    expect(followsCommand({ action: 'export_limit', params: { pct: 20 } }, { ratedKw: 50 }, reading({ p_kw: 30 }), at)).toBe('no')
    expect(followsCommand({ action: 'reset', params: {} }, { ratedKw: 22 }, reading({}), at)).toBe('yes')
  })
})

/** The simulated site on the far side of MQTT, with ingest's part (acks, latest readings) played here. */
const simulatedSite = (start: Date) => {
  const engine = new SiteEngine({ tz: DEMO_SITE.tz, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: 42, devices: DEMO_DEVICES }, start)
  const acks: { id: string; ok: boolean; error?: string }[] = []
  const gateway = new Gateway(engine, DEMO_SITE_ID, (topic, payload) => {
    const t = parseTopic(topic)
    if (t?.kind === 'commandAck') acks.push({ id: t.commandId, ...(commandAckMessage.parse(payload) as { ok: boolean; error?: string }) })
  })
  const sent: { commandId: string; command: CommandMessage }[] = []
  let up = true
  const link = {
    async sendCommand(siteId: string, commandId: string, command: CommandMessage) {
      if (!up) return false
      sent.push({ commandId, command })
      gateway.handleMessage(`site/${siteId}/cmd/${commandId}`, command)
      return true
    },
  }
  /** What ingest does with acks and readings. */
  const ingest = async () => {
    for (const a of acks.splice(0)) {
      await Command.updateOne(
        { _id: a.id, status: 'sent' },
        { $set: a.ok ? { status: 'acked', ackedAt: engine.now } : { status: 'failed', failedAt: engine.now, error: a.error } }
      )
    }
    const bat = engine.reading('bat')
    if (bat) await redis.set(`latest:${dev('bat').id}`, JSON.stringify(bat))
  }
  const run = async (seconds: number, dispatcher: CommandDispatcher) => {
    for (let s = 0; s < seconds; s += 5) {
      engine.step(5)
      gateway.tick()
      await ingest()
      await dispatcher.tick(engine.now)
    }
  }
  return { engine, gateway, link, sent, run, setUp: (v: boolean) => (up = v) }
}

const approved = async (over: Partial<CommandDoc> & { action?: string; params?: Record<string, unknown> } = {}) => {
  const window = { start: u('2026-09-24T18:00:00Z'), end: u('2026-09-24T18:30:00Z') }
  const [rec] = await Recommendation.create([
    {
      siteId: DEMO_SITE_ID,
      ruleId: 'peak-shaving',
      dedupeKey: `k${Math.random()}`,
      deviceId: dev('bat').id,
      action: 'force_discharge',
      params: { kw: 30, until: window.end.toISOString() },
      title: 'Discharge battery at 30 kW, 14:00–14:30',
      window,
      status: 'approved',
      proposedAt: u('2026-09-24T16:30:00Z'),
      expiresAt: u('2026-09-24T17:45:00Z'),
    },
  ])
  const [cmd] = await Command.create([
    {
      siteId: DEMO_SITE_ID,
      deviceId: dev('bat').id,
      recommendationId: rec._id,
      action: 'force_discharge',
      params: { kw: 30, until: window.end.toISOString() },
      sendAt: window.start,
      expiresAt: new Date(window.start.getTime() + 15 * 60_000),
      revertAt: window.end,
      status: 'created',
      ...over,
    },
  ])
  await Recommendation.updateOne({ _id: rec._id }, { $set: { commandId: cmd._id } })
  return { rec: String(rec._id), cmd: String(cmd._id) }
}

const statusOf = async (id: string) => (await Command.findById(id).lean())!.status
const recStatus = async (id: string) => (await Recommendation.findById(id).lean())!.status

describe('approve peak shaving → battery discharges → verified → reverted (simulator)', () => {
  it('goes the whole way at the window times', async () => {
    const site = simulatedSite(u('2026-09-24T17:58:00Z')) // 13:58 EDT
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { rec, cmd } = await approved()

    await site.run(60, dispatcher) // 13:59: not yet
    expect(site.sent).toHaveLength(0)
    await site.run(90, dispatcher) // 14:00:30: sent at 14:00, acked, discharging, verified
    expect(site.sent[0]).toMatchObject({ commandId: cmd, command: { deviceId: dev('bat').id, action: 'force_discharge', params: { kw: 30 } } })
    expect(site.engine.powerOf('bat')).toBeCloseTo(30, 0)
    expect(await statusOf(cmd)).toBe('verified')
    expect(await recStatus(rec)).toBe('verified')

    await site.run(30 * 60, dispatcher) // 14:30: the revert goes out and is acked
    const revert = (await Command.findOne({ revertOf: cmd }).lean())!
    expect(revert).toMatchObject({ action: 'revert', status: 'verified' })
    expect(await statusOf(cmd)).toBe('reverted')
    expect(await recStatus(rec)).toBe('reverted')
    expect(site.engine.powerOf('bat')).not.toBeCloseTo(30, 0) // back to self-consumption
  })
})

describe('failures', () => {
  it('a command with no acknowledgement in 60 s fails, and so does its recommendation', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    site.gateway.addFault({ type: 'gateway-offline' }) // takes the message, never answers
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { rec, cmd } = await approved()
    await site.run(10, dispatcher)
    expect(await statusOf(cmd)).toBe('sent')
    await site.run(60, dispatcher)
    expect(await Command.findById(cmd).lean()).toMatchObject({ status: 'failed', error: 'No acknowledgement within 60 s' })
    expect(await recStatus(rec)).toBe('failed')
  })

  it('a rejected command fails with the gateway’s reason', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    site.gateway.addFault({ type: 'command-rejected' })
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { rec, cmd } = await approved()
    await site.run(10, dispatcher)
    expect(await Command.findById(cmd).lean()).toMatchObject({ status: 'failed', error: 'rejected by device' })
    expect(await recStatus(rec)).toBe('failed')
  })

  it('keeps trying while the broker is down, and gives up once the command has expired', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    site.setUp(false)
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { rec, cmd } = await approved()
    await site.run(60, dispatcher)
    expect(await statusOf(cmd)).toBe('created')
    await site.run(15 * 60, dispatcher)
    expect(await Command.findById(cmd).lean()).toMatchObject({ status: 'failed', error: 'Expired before it could be sent' })
    expect(await recStatus(rec)).toBe('failed')
  })

  it('an acknowledged command the device doesn’t follow fails after 5 minutes and is undone', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    // A floor above the charge: the battery accepts a discharge it cannot carry out.
    site.gateway.handleMessage(`site/${DEMO_SITE_ID}/config`, { ts: '2026-09-24T18:00:00Z', batteryFloorPct: 95 })
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { rec, cmd } = await approved()
    await site.run(15, dispatcher)
    expect(await statusOf(cmd)).toBe('acked')
    await site.run(5 * 60, dispatcher)
    expect(await Command.findById(cmd).lean()).toMatchObject({ status: 'failed', error: 'Acknowledged, but the device did not follow it (telemetry)' })
    expect(await recStatus(rec)).toBe('failed')
    expect(await Command.exists({ revertOf: cmd })).toBeTruthy()
  })
})

describe('reverting a reserve change', () => {
  it('waits for a reading with the current reserve before changing it', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const { cmd } = await approved({ action: 'set_reserve', params: { pct: 80 } })
    await dispatcher.tick(u('2026-09-24T18:00:05Z')) // nothing from the battery yet
    expect(await statusOf(cmd)).toBe('created')
    await site.run(10, dispatcher)
    expect(await statusOf(cmd)).not.toBe('created')
  })

  it('puts the reserve back to what it was', async () => {
    const site = simulatedSite(u('2026-09-24T18:00:00Z'))
    const dispatcher = new CommandDispatcher({ redis, link: site.link, logger: log })
    const before = site.engine.batteryState().reservePct
    const { cmd } = await approved({ action: 'set_reserve', params: { pct: 80 } })
    await site.run(10, dispatcher)
    expect(site.engine.batteryState().reservePct).toBe(80)
    expect((await Command.findById(cmd).lean())!.revertParams).toEqual({ pct: before })
    await site.run(31 * 60, dispatcher)
    expect(await Command.findOne({ revertOf: cmd }).lean()).toMatchObject({ action: 'set_reserve', params: { pct: before }, status: 'verified' })
    expect(site.engine.batteryState().reservePct).toBe(before)
    expect(await statusOf(cmd)).toBe('reverted')
  })
})
