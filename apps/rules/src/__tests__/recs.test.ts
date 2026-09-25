/**
 * P3-01: the recommendation rule framework (config, context, runner) with a stand-in rule. The
 * App v2 rules themselves are P3-02.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Redis } from 'ioredis'
import pino from 'pino'
import { Calendar, Command, Device, Forecast, Interval15, Recommendation, RuleConfig, Site, Tariff, initModels } from '@ecomanage/db'
import { DEMO_CALENDAR_INPUT, TARIFF_TEMPLATES, dedupeKeyOf, siteEventsChannel, type Proposal } from '@ecomanage/shared'
import { resolveRuleConfig } from '../recs/config'
import { loadRecContext } from '../recs/context'
import { proposeForSite } from '../recs/runner'
import type { RecContext, Rule } from '../recs/types'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_rules_recs`
const REDIS = process.env.REDIS_TEST_URL?.replace(/\/\d+$/, '/9') || 'redis://redis:6379/9'
const TZ = 'America/Toronto'
const siteId = new mongoose.Types.ObjectId()
const sid = String(siteId)
const bat = new mongoose.Types.ObjectId()
const u = (iso: string) => new Date(iso)
const NOW = u('2026-09-24T16:37:00Z') // Thu 12:37 EDT; the quarter is 16:30Z
const log = pino({ level: 'silent' })

/**
 * Stand-in peak rule: if the forecast net load goes over the cap in the next 4 h, discharge the
 * battery through the hour around the peak at (excess + margin) rounded up to 5 kW.
 */
const standIn: Rule = {
  id: 'peak-shaving',
  evaluate(ctx, params) {
    const cap = ctx.site.demandCapKw
    if (!cap || !ctx.battery) return null
    const soon = ctx.forecast.filter((s) => s.ts.getTime() < ctx.now.getTime() + 4 * 3600_000 && s.netKw !== null)
    const peak = soon.reduce<(typeof soon)[number] | null>((m, s) => (!m || s.netKw! > m.netKw! ? s : m), null)
    if (!peak || peak.netKw! <= cap) return null
    const kw = Math.ceil((peak.netKw! - cap + Number(params.marginKw)) / 5) * 5
    const window = { start: new Date(peak.ts.getTime() - 30 * 60_000), end: new Date(peak.ts.getTime() + 30 * 60_000) }
    const proposal: Proposal = {
      deviceId: ctx.battery.deviceId,
      action: 'force_discharge',
      params: { kw },
      window,
      inputs: [
        { label: 'Forecast peak', value: `${peak.netKw} kW` },
        { label: 'Cap', value: `${cap} kW` },
      ],
      dedupeKey: dedupeKeyOf('peak-shaving', ctx.battery.deviceId, window),
      title: `Discharge battery at ${kw} kW`,
    }
    return proposal
  },
  check(_ctx, action, params) {
    return [{ text: `Within the ${params.maxKw} kW discharge limit`, pass: Number(action.params.kw) <= Number(params.maxKw) }]
  },
  saving(ctx, action) {
    const rate = ctx.tariff?.demandRateCents ?? 0
    return { cents: Math.round(Number(action.params.kw) * rate), calc: `${action.params.kw} kW × $${rate / 100}/kW` }
  },
}

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

const forecastWithPeak = (netPeakKw: number, at = u('2026-09-24T19:15:00Z')) =>
  Forecast.create([
    { siteId, kind: 'pv', issuedAt: u('2026-09-24T16:00:00Z'), source: 'simulated', points: [{ ts: at, kw: 20 }], weather: [{ ts: at, tempC: 26, cloud: 0.9 }] },
    { siteId, kind: 'load', issuedAt: u('2026-09-24T16:00:00Z'), source: 'simulated', points: [{ ts: at, kw: netPeakKw + 20 }, { ts: u('2026-09-24T16:00:00Z'), kw: 500 }] },
  ])

beforeEach(async () => {
  await redis.flushdb()
  await Promise.all([Site, Device, Calendar, Tariff, Interval15, Forecast, Command, Recommendation, RuleConfig].map((m) => (m as typeof Site).deleteMany({})))
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, demandCapKw: 120, currency: 'CAD', batteryFloorPct: 10 })
  await Device.create({ _id: bat, siteId, type: 'battery', name: 'Battery', ratedKw: 60, capacityKwh: 200, status: 'live' })
  await redis.set(`latest:${bat}`, JSON.stringify({ ts: NOW.toISOString(), p_kw: 0, soc_pct: 68, reserve_pct: 20, q: 'ok' }))
  await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-01-01' })
})

describe('rule config', () => {
  it('starts from the App v2 defaults and takes what the site saved', () => {
    const c = resolveRuleConfig([
      { ruleId: 'peak-shaving', on: null, params: { marginKw: 15 } },
      { ruleId: 'storm-reserve', on: true, params: {} },
      { ruleId: 'approval', on: null, params: { expireMin: 30, who: 'owner' } },
    ])
    expect(c.rules['peak-shaving']).toEqual({ on: true, params: { socSchoolPct: 30, socOtherPct: 15, maxKw: 60, marginKw: 15 } })
    expect(c.rules['storm-reserve'].on).toBe(true)
    expect(c.rules['ev-offpeak']).toEqual({ on: true, params: { bufferPct: 20, fleetOnly: true } })
    expect(c.approval).toEqual({ who: 'owner', expireMin: 30, email: 'approvers' })
  })
})

describe('context', () => {
  it('gathers the site state at the quarter hour', async () => {
    await Calendar.create({ siteId, ...DEMO_CALENDAR_INPUT })
    await Interval15.create([
      { siteId, start: u('2026-09-10T19:15:00Z'), grid: 28, demandKw: 112 },
      { siteId, start: u('2026-08-20T19:15:00Z'), grid: 40, demandKw: 160 }, // last billing period
    ])
    await forecastWithPeak(140)
    await Command.create([
      { siteId, deviceId: String(bat), action: 'force_discharge', expiresAt: u('2026-09-24T17:00:00Z'), status: 'sent' },
      { siteId, deviceId: String(bat), action: 'set_reserve', expiresAt: u('2026-09-24T17:00:00Z'), status: 'verified' },
    ])
    const ctx = (await loadRecContext(sid, u('2026-09-24T16:30:00Z'), { redis, demand: null, approval: { who: 'owner-or-manager', expireMin: 15, email: 'approvers' } }))!
    expect(ctx).toMatchObject({
      today: '2026-09-24',
      dayClass: 'open',
      site: { name: 'Maple Grove School', demandCapKw: 120, currency: 'CAD' },
      tariff: { version: 1, demandRateCents: 1400 },
      period: { peakKw: 112, peakAt: u('2026-09-10T19:15:00Z') },
      battery: { deviceId: String(bat), socPct: 68, reservePct: 20, usableKwh: 200, maxKw: 60, floorPct: 10 },
    })
    // Only steps from now on; net = load − PV
    expect(ctx.forecast).toEqual([{ ts: u('2026-09-24T19:15:00Z'), pvKw: 20, loadKw: 160, netKw: 140, tempC: 26 }])
    expect(ctx.commands.map((c) => c.status)).toEqual(['sent'])
  })
})

describe('proposeForSite', () => {
  it('proposes once per dedupeKey, with checks, saving and expiry, and tells the Inbox', async () => {
    await forecastWithPeak(140)
    const sub = redis.duplicate()
    const events: unknown[] = []
    await sub.subscribe(siteEventsChannel(sid))
    sub.on('message', (_c, m) => events.push(JSON.parse(m)))

    const [r] = await proposeForSite(sid, NOW, { redis, logger: log, rules: [standIn] })
    expect(r).toMatchObject({
      ruleId: 'peak-shaving',
      deviceId: String(bat),
      action: 'force_discharge',
      params: { kw: 30 }, // (140 − 120 + 10) → 30
      title: 'Discharge battery at 30 kW',
      window: { start: u('2026-09-24T18:45:00Z'), end: u('2026-09-24T19:45:00Z') },
      checks: [{ text: 'Within the 60 kW discharge limit', pass: true }],
      expectedSavingCents: 42_000,
      calc: '30 kW × $14/kW',
      status: 'proposed',
      proposedAt: u('2026-09-24T16:30:00Z'),
      expiresAt: u('2026-09-24T18:30:00Z'),
    })
    await new Promise((res) => setTimeout(res, 100))
    expect(events).toEqual([{ type: 'inbox', itemType: 'decide', itemId: String(r._id) }])
    sub.disconnect()

    expect(await proposeForSite(sid, u('2026-09-24T16:45:00Z'), { redis, logger: log, rules: [standIn] })).toEqual([])
    await Recommendation.updateOne({ _id: r._id }, { $set: { status: 'declined' } })
    expect(await proposeForSite(sid, u('2026-09-24T16:45:00Z'), { redis, logger: log, rules: [standIn] })).toHaveLength(1)
  })

  it('gives the same proposal for the same state', async () => {
    await forecastWithPeak(140)
    const approval = { who: 'owner-or-manager' as const, expireMin: 15, email: 'approvers' as const }
    const ctx = (await loadRecContext(sid, u('2026-09-24T16:30:00Z'), { redis, demand: null, approval }))!
    const again = (await loadRecContext(sid, u('2026-09-24T16:30:00Z'), { redis, demand: null, approval }))!
    const params = resolveRuleConfig([]).rules['peak-shaving'].params
    expect(standIn.evaluate(again, params)).toEqual(standIn.evaluate(ctx, params))
    expect(standIn.evaluate(JSON.parse(JSON.stringify(ctx), (k, v) => (k === 'ts' || k === 'start' || k === 'end' || k === 'now' ? new Date(v) : v)) as RecContext, params)).toEqual(
      standIn.evaluate(ctx, params)
    )
  })

  it('uses the site’s settings: off means off, and saved parameters reach the rule', async () => {
    await forecastWithPeak(140)
    await RuleConfig.create({ siteId, ruleId: 'peak-shaving', on: false })
    expect(await proposeForSite(sid, NOW, { redis, logger: log, rules: [standIn] })).toEqual([])
    await RuleConfig.updateOne({ siteId, ruleId: 'peak-shaving' }, { $set: { on: true, params: { marginKw: 25, maxKw: 40 } } })
    const [r] = await proposeForSite(sid, NOW, { redis, logger: log, rules: [standIn] })
    expect(r).toMatchObject({ params: { kw: 45 }, checks: [{ text: 'Within the 40 kW discharge limit', pass: false }] })
  })

  it('skips proposals there is no time left to decide on', async () => {
    await forecastWithPeak(140, u('2026-09-24T17:15:00Z')) // window starts 16:45; decide by 16:30 = now
    expect(await proposeForSite(sid, NOW, { redis, logger: log, rules: [standIn] })).toEqual([])
  })

  it('keeps going when one rule fails, and stays single when two runs race', async () => {
    await forecastWithPeak(140)
    const broken: Rule = { ...standIn, id: 'storm-reserve', evaluate: () => { throw new Error('boom') } }
    await RuleConfig.create({ siteId, ruleId: 'storm-reserve', on: true })
    const runs = await Promise.all([1, 2].map(() => proposeForSite(sid, NOW, { redis, logger: log, rules: [broken, standIn] })))
    expect(runs.flat()).toHaveLength(1)
    expect(await Recommendation.countDocuments({ siteId })).toBe(1)
  })

  it('does nothing without a forecast peak, or for an unknown site', async () => {
    await forecastWithPeak(100)
    expect(await proposeForSite(sid, NOW, { redis, logger: log, rules: [standIn] })).toEqual([])
    expect(await proposeForSite(String(new mongoose.Types.ObjectId()), NOW, { redis, logger: log, rules: [standIn] })).toEqual([])
  })
})
