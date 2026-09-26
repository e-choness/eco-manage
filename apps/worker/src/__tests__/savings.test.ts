/**
 * P3-04: the saving a peak-shaving discharge actually made, measured the next day.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Interval15, Recommendation, Site, Tariff, initModels } from '@ecomanage/db'
import { TARIFF_TEMPLATES } from '@ecomanage/shared'
import { measurePeakShaving, measureSavings } from '../savings'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_savings`
const u = (iso: string) => new Date(iso)
const siteId = new mongoose.Types.ObjectId()
const window = { start: u('2026-09-24T18:00:00Z'), end: u('2026-09-24T21:00:00Z') }
const row = (iso: string, gridKwh: number, battKwh = 0) => ({ start: u(iso), grid: gridKwh, export: 0, batt: battKwh, demandKw: gridKwh * 4 })

// The month so far peaked at 112 kW; during the window the battery put out 7.5 kWh a quarter
// (30 kW) at the busiest step, where the site took 26.5 kWh from the grid (106 kW): 136 kW without it.
const rows = [row('2026-09-09T19:15:00Z', 28), row('2026-09-24T19:15:00Z', 26.5, 7.5), row('2026-09-24T19:30:00Z', 25, 5)]

describe('measurePeakShaving', () => {
  it('compares the period’s demand charge with and without the battery’s discharge', () => {
    expect(measurePeakShaving(window, rows, 1400)).toEqual({
      cents: 33_600,
      calc: 'period peak 136 kW without the battery − 112 kW with it = 24 kW × $14/kW = $336',
    })
  })

  it('finds nothing to credit when the month peak was higher anyway', () => {
    expect(measurePeakShaving(window, [row('2026-09-09T19:15:00Z', 40), ...rows.slice(1)], 1400).cents).toBe(0)
  })
})

describe('measureSavings', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
    await mongoose.connection.dropDatabase()
    await initModels()
    await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', billDay: 1 })
    await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-01-01' })
    await Interval15.create(rows.map((r) => ({ siteId, ...r })))
  })

  afterAll(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  })

  beforeEach(async () => {
    await Recommendation.deleteMany({})
  })

  const rec = (over: object = {}) =>
    Recommendation.create({
      siteId,
      ruleId: 'peak-shaving',
      dedupeKey: `k${Math.random()}`,
      deviceId: 'bat',
      action: 'force_discharge',
      title: 'Discharge battery at 30 kW, 14:00–17:00',
      window,
      status: 'reverted',
      proposedAt: u('2026-09-24T16:30:00Z'),
      expiresAt: u('2026-09-24T17:45:00Z'),
      expectedSavingCents: 26_600,
      ...over,
    })

  it('waits for the day to end, then stores the measured saving once', async () => {
    const r = await rec()
    expect(await measureSavings(u('2026-09-24T23:00:00Z'))).toBe(0) // 19:00 local, same day
    expect(await measureSavings(u('2026-09-25T06:00:00Z'))).toBe(1) // 02:00 the next day
    expect(await Recommendation.findById(r._id).lean()).toMatchObject({ actualSavingCents: 33_600, actualCalc: expect.stringContaining('= $336'), measuredAt: u('2026-09-25T06:00:00Z') })
    expect(await measureSavings(u('2026-09-25T07:00:00Z'))).toBe(0)
  })

  it('leaves rules it can’t measure yet, and failed or declined proposals, without a figure', async () => {
    const ev = await rec({ ruleId: 'ev-offpeak' })
    const failed = await rec({ status: 'failed' })
    await measureSavings(u('2026-09-25T06:00:00Z'))
    expect(await Recommendation.findById(ev._id).lean()).toMatchObject({ actualSavingCents: null, measuredAt: u('2026-09-25T06:00:00Z') })
    expect((await Recommendation.findById(failed._id).lean())!.measuredAt).toBeNull()
  })
})
