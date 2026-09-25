/**
 * P1-07 acceptance: 15-minute intervals from counter differences; a meter gap produces estimated
 * intervals and the backfill replaces them. Real MongoDB + Redis.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Redis } from 'ioredis'
import pino from 'pino'
import { Device, Interval15, Telemetry, initModels } from '@ecomanage/db'
import { DEMO_DEVICES, DEMO_SITE_ID, topics, type TelemetryReading } from '@ecomanage/shared'
import { Ingestor } from '../ingestor'
import { RollupScheduler, computeInterval, rollUp } from '../intervals'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_intervals`
const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/3') || 'redis://redis:6379/3'
const log = pino({ level: 'silent' })
const dev = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!
const T0 = Date.parse('2026-09-24T16:00:00Z')
const at = (min: number, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000)

// Constant site: building 60 kW. Site signs: PV +, battery + discharge, loads -, meter + import.
const POWER = { invA: 30, bat: 10, ev1: -20, hp: -10, meter: 50 }
const BASE = { invA: 1000, bat: 500, ev1: 200, hp: 300, meter: 40_000 }

const reading = (key: keyof typeof POWER, t: Date, power = POWER): TelemetryReading => {
  const hours = (t.getTime() - T0) / 3_600_000
  const p = power[key]
  const e = BASE[key] + Math.abs(p) * hours
  switch (key) {
    case 'invA':
      return { ts: t.toISOString(), p_kw: p, e_out_kwh: e, q: 'ok' }
    case 'bat':
      return { ts: t.toISOString(), p_kw: p, e_in_kwh: 100, e_out_kwh: e, q: 'ok' }
    case 'meter':
      return p >= 0
        ? { ts: t.toISOString(), p_kw: p, e_in_kwh: e, e_out_kwh: 10, q: 'ok' }
        : { ts: t.toISOString(), p_kw: p, e_in_kwh: BASE.meter, e_out_kwh: 10 + Math.abs(p) * hours, q: 'ok' }
    default:
      return { ts: t.toISOString(), p_kw: p, e_in_kwh: e, q: 'ok' }
  }
}

let redis: Redis
let scheduler: RollupScheduler
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
  await Promise.all([Telemetry.deleteMany({}), Device.deleteMany({}), Interval15.deleteMany({})])
  await Device.insertMany(
    (['invA', 'bat', 'ev1', 'hp', 'meter'] as const).map((k) => ({
      _id: dev(k).id,
      siteId: DEMO_SITE_ID,
      type: dev(k).type,
      name: dev(k).name,
      profileId: dev(k).profileId,
      status: 'live',
    }))
  )
  scheduler = new RollupScheduler(log)
  ingestor = new Ingestor({ redis, logger: log, flushMs: 0, onReading: (s, ts, r) => scheduler.markDirty(s, ts, r) })
})

/** Sends 5-second readings for [fromMin, toMin), skipping the meter where `skipMeter` says so. */
const stream = async (fromMin: number, toMin: number, opts: { skipMeter?: (t: Date) => boolean; receivedAt?: Date; power?: typeof POWER } = {}) => {
  for (let s = fromMin * 60; s <= toMin * 60; s += 5) {
    const t = new Date(T0 + s * 1000)
    for (const key of Object.keys(POWER) as (keyof typeof POWER)[]) {
      if (key === 'meter' && opts.skipMeter?.(t)) continue
      await ingestor.handle(topics.telemetry(DEMO_SITE_ID, dev(key).id), JSON.stringify(reading(key, t, opts.power)), opts.receivedAt ?? t)
    }
  }
  await ingestor.flush()
}

describe('one interval', () => {
  it('takes energy from counter differences and demand from the meter import', async () => {
    await stream(0, 15)
    const v = await computeInterval(DEMO_SITE_ID, at(0))
    expect(v).toEqual({ pv: 7.5, used: 7.5, batt: 2.5, grid: 12.5, export: 0, bld: 15, hp: 2.5, ev: 5, demandKw: 50, quality: 'ok' })
  })

  it('splits export out of solar use', async () => {
    const sunny = { ...POWER, invA: 100, meter: -20 }
    await stream(0, 15, { power: sunny })
    const v = await computeInterval(DEMO_SITE_ID, at(0))
    expect(v).toMatchObject({ pv: 25, export: 5, grid: 0, used: 20, bld: 15, demandKw: 0, quality: 'ok' })
  })

  it('falls back to average power when the meter has readings but no counters at the boundaries', async () => {
    await stream(0, 15, { skipMeter: (t) => t < at(3) || t > at(10) })
    const v = await computeInterval(DEMO_SITE_ID, at(0))
    expect(v).toMatchObject({ grid: 12.5, demandKw: 50, quality: 'estimated' })
  })

  it('returns nothing for a site without data', async () => {
    expect(await computeInterval(DEMO_SITE_ID, at(0))).toBeNull()
    expect(await computeInterval('650000000000000000000077', at(0))).toBeNull()
  })
})

describe('meter gap and backfill', () => {
  const gap = (t: Date) => t > at(14, 30) && t <= at(30)

  it('estimates the gap from the other devices, then replaces it when the meter data arrives', async () => {
    await stream(0, 45, { skipMeter: gap })
    expect(await scheduler.tick(at(45, 31))).toBe(3)

    const before = await Interval15.find().sort({ start: 1 }).lean()
    expect(before.map((i) => [i.start.toISOString().slice(11, 16), i.quality])).toEqual([
      ['16:00', 'ok'],
      ['16:15', 'estimated'],
      ['16:30', 'estimated'],
    ])
    // Estimated from the previous interval's building load (15 kWh) plus EV and heat pump.
    expect(before[1]).toMatchObject({ grid: 12.5, demandKw: 50, bld: 15 })

    // The gateway resends the meter's buffered readings 25 minutes later.
    for (let s = 14 * 60 + 35; s <= 30 * 60; s += 5) {
      const t = new Date(T0 + s * 1000)
      await ingestor.handle(topics.telemetry(DEMO_SITE_ID, dev('meter').id), JSON.stringify(reading('meter', t)), at(55))
    }
    await ingestor.flush()
    // The resent readings touch 16:00 (from 16:14:35), 16:15 and 16:30 (16:30:00 itself).
    expect(await scheduler.tick(at(55, 1))).toBe(3)

    const after = await Interval15.find().sort({ start: 1 }).lean()
    expect(after.every((i) => i.quality === 'ok')).toBe(true)
    expect(after.map((i) => [i.grid, i.demandKw, i.bld])).toEqual([
      [12.5, 50, 15],
      [12.5, 50, 15],
      [12.5, 50, 15],
    ])
    expect(await Telemetry.countDocuments({ q: 'backfilled' })).toBeGreaterThan(0)
  })
})

describe('scheduler', () => {
  it('waits for the grace period, rolls up each interval once, and resumes after a restart', async () => {
    await stream(0, 31)
    expect(await scheduler.tick(at(15, 20))).toBe(0)
    expect(await scheduler.tick(at(15, 31))).toBe(1)
    expect(await scheduler.tick(at(16))).toBe(0)
    expect(await scheduler.tick(at(30, 31))).toBe(1)

    const restarted = new RollupScheduler(log)
    expect(await restarted.tick(at(31))).toBe(0)
    expect(await Interval15.countDocuments()).toBe(2)
  })

  it('upserts, so recomputing an interval never duplicates it', async () => {
    await stream(0, 15)
    await rollUp(DEMO_SITE_ID, at(0))
    await rollUp(DEMO_SITE_ID, at(0))
    expect(await Interval15.countDocuments()).toBe(1)
  })
})
