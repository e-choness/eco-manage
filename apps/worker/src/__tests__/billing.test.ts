/**
 * P2-03: storing interval costs and bills (the pricing itself is tested in @ecomanage/shared).
 *
 * Toronto, bill day 1, period 2026-09 (Sep 1 04:00Z – Oct 1 04:00Z). Tariff v1 (TOU-D) from
 * Aug 1, v2 (same, peak 30¢) from Sep 15.
 *
 *   Thu Sep 10 15:15 EDT  grid 20 kWh, 80 kW   Peak v1 27¢      540
 *   Thu Sep 10 12:00 EDT  grid 10, export 2    Mid 16¢          160, credit 2 × 5¢ = 10
 *   Sat Sep 12 15:00 EDT  grid 8               Off-peak 9¢       72
 *   Thu Sep 17 15:15 EDT  grid 25, 100 kW      Peak v2 30¢      750
 *   Thu Sep 17 03:00 EDT  grid 4, estimated    Off-peak 9¢       36
 *   (Aug 31 23:45 EDT and Oct 2 fall outside the period.)
 *
 *   energy 1290 + 160 + 108, demand 100 kW × $14 = 140000, fixed 9000, credit 10
 *   total = 1558 + 140000 + 9000 − 10 = 150548¢
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Bill, Interval15, Site, Tariff, initModels } from '@ecomanage/db'
import { TARIFF_TEMPLATES } from '@ecomanage/shared'
import { costPendingIntervals, nightlyBills, refreshBill } from '../billing'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker`
const TZ = 'America/Toronto'
const tou = TARIFF_TEMPLATES[0].tariff
const siteId = new mongoose.Types.ObjectId()
const u = (iso: string) => new Date(iso)
const NOW = u('2026-10-05T12:00:00Z') // period closed

const v1 = { ...tou, siteId, version: 1, validFrom: '2026-08-01' }
const v2 = {
  ...tou,
  siteId,
  version: 2,
  validFrom: '2026-09-15',
  periods: tou.periods.map((p) => (p.name === 'Peak' && p.season === 'summer' ? { ...p, rateCents: 30 } : p)),
}

const fixture = [
  { start: u('2026-09-10T19:15:00Z'), grid: 20, demandKw: 80 },
  { start: u('2026-09-10T16:00:00Z'), grid: 10, export: 2, pv: 2, demandKw: 40 },
  { start: u('2026-09-12T19:00:00Z'), grid: 8, demandKw: 32 },
  { start: u('2026-09-17T19:15:00Z'), grid: 25, demandKw: 100 },
  { start: u('2026-09-17T07:00:00Z'), grid: 4, demandKw: 16, quality: 'estimated' },
  { start: u('2026-09-01T03:45:00Z'), grid: 99, demandKw: 396 }, // Aug 31 23:45 EDT
  { start: u('2026-10-02T19:15:00Z'), grid: 99, demandKw: 396 },
]

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Site.deleteMany({}), Tariff.deleteMany({}), Interval15.deleteMany({}), Bill.deleteMany({})])
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: TZ, billDay: 1 })
  await Tariff.create([v1, v2])
  await Interval15.create(fixture.map((f) => ({ siteId, ...f })))
})

describe('refreshBill', () => {
  it('matches the hand-worked September bill to the cent', async () => {
    const site = (await Site.findById(siteId).lean())!
    const bill = await refreshBill(site, u('2026-09-20T12:00:00Z'), NOW)
    expect(bill).toMatchObject({
      period: '2026-09',
      start: u('2026-09-01T04:00:00Z'),
      end: u('2026-10-01T04:00:00Z'),
      inProgress: false,
      lines: { energyPkCents: 1290, energyMdCents: 160, energyOpCents: 108, demandCents: 140_000, fixedCents: 9000, exportCreditCents: 10 },
      energyKwh: { pk: 45, md: 10, op: 12, export: 2 },
      totalCents: 150_548,
      peakKw: 100,
      peakAt: u('2026-09-17T19:15:00Z'),
      tariffVersion: 2,
      tariffVersions: [1, 2],
      intervals: 5,
      estimatedShare: 0.2,
      unpricedIntervals: 0,
    })
    expect(await Bill.countDocuments({ siteId, period: '2026-09' })).toBe(1)
  })
})

describe('savings against the grid-only baseline (P2-04)', () => {
  it('stays hidden until the site has 7 days of intervals', async () => {
    const site = (await Site.findById(siteId).lean())!
    expect(await refreshBill(site, u('2026-09-20T12:00:00Z'), NOW)).toMatchObject({ savedCents: null, savings: null })
    // A week of empty August quarter hours before the fixture
    await Interval15.insertMany(
      Array.from({ length: 7 * 96 }, (_, i) => ({ siteId, start: new Date(Date.parse('2026-08-01T04:00:00Z') + i * 15 * 60_000), costedAt: NOW }))
    )
    const bill = await refreshBill(site, u('2026-09-20T12:00:00Z'), NOW)
    // The only PV in the fixture is the 2 kWh exported: only its credit (2 × 5¢) is saved
    expect(bill).toMatchObject({ totalCents: 150_548, savedCents: 10, savings: { solarCents: 10, batteryCents: 0, demandCents: 0, baselineCents: 150_558 } })
  })
})

describe('costPendingIntervals', () => {
  it('prices new intervals once and refreshes the bills they belong to', async () => {
    expect(await costPendingIntervals(NOW)).toBe(7)
    expect(await Interval15.countDocuments({ costedAt: null })).toBe(0)
    const peak = await Interval15.findOne({ siteId, start: u('2026-09-17T19:15:00Z') }).lean()
    expect(peak).toMatchObject({ costCents: { pk: 750, md: 0, op: 0 }, tariffVersion: 2 })
    const periods = (await Bill.find({ siteId }).sort({ period: 1 }).lean()).map((b) => [b.period, b.totalCents])
    expect(periods).toEqual([
      ['2026-08', 99 * 16 + 396 * 1400 + 9000], // Aug 31 23:45 EDT: Monday evening Mid, v1
      ['2026-09', 150_548],
      ['2026-10', 99 * 30 + 396 * 1400 + 9000], // Oct 2 15:15 EDT: Peak, v2
    ])
    expect(await costPendingIntervals(NOW)).toBe(0)
  })

  it('re-prices an interval that ingest recomputed', async () => {
    await costPendingIntervals(NOW)
    await Interval15.updateOne({ siteId, start: u('2026-09-12T19:00:00Z') }, { $set: { grid: 18, costedAt: null } })
    expect(await costPendingIntervals(NOW)).toBe(1)
    expect((await Bill.findOne({ siteId, period: '2026-09' }).lean())!.totalCents).toBe(150_548 + 90)
  })
})

describe('nightlyBills', () => {
  it('recomputes current and previous periods for sites at 01:00 local', async () => {
    const oneAm = u('2026-10-05T05:30:00Z') // 01:30 EDT
    expect(await nightlyBills(u('2026-10-05T12:00:00Z'))).toBe(0)
    expect(await nightlyBills(oneAm)).toBe(1)
    expect((await Bill.find({ siteId }).lean()).map((b) => b.period).sort()).toEqual(['2026-09', '2026-10'])
  })
})
