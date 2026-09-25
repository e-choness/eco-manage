/**
 * P2-03/P2-04: pure bill maths. The worker's tests cover storing bills; these cover the pricing,
 * including the hand-worked September bill and the savings split.
 *
 * Toronto, bill day 1, period 2026-09. Tariff v1 (TOU-D) from Aug 1, v2 (peak 30¢) from Sep 15.
 *   Thu Sep 10 15:15 EDT  grid 20 kWh, 80 kW   Peak v1 27¢      540
 *   Thu Sep 10 12:00 EDT  grid 10, export 2    Mid 16¢          160, credit 2 × 5¢ = 10
 *   Sat Sep 12 15:00 EDT  grid 8               Off-peak 9¢       72
 *   Thu Sep 17 15:15 EDT  grid 25, 100 kW      Peak v2 30¢      750
 *   Thu Sep 17 03:00 EDT  grid 4, estimated    Off-peak 9¢       36
 *   total = 1558 energy + 140000 demand + 9000 fixed − 10 credit = 150548¢
 */
import { describe, expect, it } from 'vitest'
import { TARIFF_TEMPLATES, billingPeriod, bucketOf, computeBill, costInterval, tariffFromDoc, type IntervalLike, type Tariff } from '../index'

const TZ = 'America/Toronto'
const tou = TARIFF_TEMPLATES[0].tariff
const u = (iso: string) => new Date(iso)
const NOW = u('2026-10-05T12:00:00Z')

const v1 = { ...tou, version: 1, validFrom: '2026-08-01' } as Tariff
const v2 = {
  ...tou,
  version: 2,
  validFrom: '2026-09-15',
  periods: tou.periods.map((p) => (p.name === 'Peak' && p.season === 'summer' ? { ...p, rateCents: 30 } : p)),
} as Tariff

const row = (iso: string, grid: number, extra: Partial<IntervalLike> = {}): IntervalLike => ({ start: u(iso), grid, export: 0, demandKw: grid * 4, quality: 'ok', ...extra })
const september = [
  row('2026-09-10T19:15:00Z', 20),
  row('2026-09-10T16:00:00Z', 10, { export: 2, pv: 2 }),
  row('2026-09-12T19:00:00Z', 8),
  row('2026-09-17T19:15:00Z', 25),
  row('2026-09-17T07:00:00Z', 4, { quality: 'estimated' }),
]
const sep = billingPeriod(u('2026-09-10T12:00:00Z'), TZ, 1)

describe('bucketOf', () => {
  it('maps period names to bill lines', () => {
    expect(['Peak', 'On-peak', 'Mid', 'Shoulder', 'Off-peak', 'Offpeak', 'Flat'].map(bucketOf)).toEqual(['pk', 'pk', 'md', 'md', 'op', 'op', 'md'])
  })
})

describe('tariffFromDoc', () => {
  it('fills the lists and holidays a stored document may lack', () => {
    expect(tariffFromDoc({ version: 1, validFrom: '2026-01-01' })).toMatchObject({ seasons: [], periods: [], holidays: { dates: [], treatAs: 'weekend' } })
    expect(tariffFromDoc(v1).periods).toBe(v1.periods)
  })
})

describe('costInterval', () => {
  it('prices an interval with the version valid on its local date', () => {
    expect(costInterval(row('2026-09-10T19:15:00Z', 20), [v1, v2], TZ)).toEqual({ costCents: { pk: 540, md: 0, op: 0 }, creditCents: 0, tariffVersion: 1 })
    expect(costInterval(row('2026-09-17T19:15:00Z', 25, { export: 1 }), [v1, v2], TZ)).toEqual({ costCents: { pk: 750, md: 0, op: 0 }, creditCents: 5, tariffVersion: 2 })
  })

  it('leaves an interval before the first tariff unpriced', () => {
    expect(costInterval(row('2026-07-01T19:15:00Z', 20), [v1], TZ)).toEqual({ costCents: { pk: 0, md: 0, op: 0 }, creditCents: 0, tariffVersion: null })
  })
})

describe('computeBill', () => {
  it('matches the hand-worked September bill to the cent', () => {
    expect(computeBill(sep, september, [v1, v2], TZ, NOW)).toEqual({
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
      savedCents: null,
      savings: null,
    })
  })

  it('bills an open period with the version in force today', () => {
    const bill = computeBill(sep, [row('2026-09-10T19:15:00Z', 20)], [v1, v2], TZ, u('2026-09-11T12:00:00Z'))
    expect(bill).toMatchObject({ inProgress: true, tariffVersion: 1, totalCents: 540 + 80 * 1400 + 9000 })
  })

  it('rounds each line once, not each interval', () => {
    // Three Saturday quarter hours of 0.05 kWh at 9¢: 0.45¢ each, 1.35¢ together → 1¢ (per interval would be 0¢)
    const rows = [0, 15, 30].map((m) => row(new Date(Date.parse('2026-09-12T19:00:00Z') + m * 60_000).toISOString(), 0.05))
    expect(computeBill(sep, rows, [v1], TZ, NOW).lines.energyOpCents).toBe(1)
  })

  it('counts intervals no tariff covers, and has no charges without a tariff', () => {
    const july = billingPeriod(u('2026-07-10T12:00:00Z'), TZ, 1)
    expect(computeBill(july, [row('2026-07-10T19:15:00Z', 20)], [v1], TZ, NOW)).toMatchObject({ unpricedIntervals: 1, totalCents: 0, tariffVersion: null })
  })

  it('handles a period with no data', () => {
    expect(computeBill(sep, [], [v1], TZ, NOW)).toMatchObject({ totalCents: 9000, peakKw: 0, peakAt: null, estimatedShare: 0, intervals: 0 })
  })
})

describe('savings against the grid-only baseline (P2-04)', () => {
  /*
   * Thu Sep 10, tariff v1:
   *   15:15 Peak 27¢     grid 20, pv 10, batt +5 (discharge)  load 35   solar 270, battery 135
   *   03:00 Off-peak 9¢  grid 30, batt −10 (charge)           load 20   battery −90
   *   12:00 Mid 16¢      grid 0, pv 15, export 3              load 12   solar 192 + credit 15
   *
   *   actual   = 540 + 270 energy + 120 kW × $14 + 9000 − 15 = 177795
   *   baseline = 945 + 180 + 192 energy + 140 kW × $14 + 9000 = 206317
   *   saved    = solar 477 + battery 45 + demand 28000 = 28522 = baseline − actual
   */
  const rows = [
    row('2026-09-10T19:15:00Z', 20, { pv: 10, batt: 5, demandKw: 80 }),
    row('2026-09-10T07:00:00Z', 30, { pv: 0, batt: -10, demandKw: 120 }),
    row('2026-09-10T16:00:00Z', 0, { export: 3, pv: 15, batt: 0, demandKw: 0 }),
  ]

  it('splits the saving into solar, battery shifting and demand avoided', () => {
    const bill = computeBill(sep, rows, [v1], TZ, NOW, true)
    expect(bill.totalCents).toBe(177_795)
    expect(bill.savings).toEqual({ baselineCents: 206_317, solarCents: 477, batteryCents: 45, demandCents: 28_000, baselinePeakKw: 140 })
    expect(bill.savedCents).toBe(28_522)
  })

  it('is left out when not asked for', () => {
    expect(computeBill(sep, rows, [v1], TZ, NOW)).toMatchObject({ savedCents: null, savings: null })
  })

  it('counts intervals without PV or battery data as grid-only', () => {
    expect(computeBill(sep, [row('2026-09-10T19:15:00Z', 20)], [v1], TZ, NOW, true).savings).toEqual({
      baselineCents: 540 + 80 * 1400 + 9000,
      solarCents: 0,
      batteryCents: 0,
      demandCents: 0,
      baselinePeakKw: 80,
    })
  })

  it('is zero without a tariff in force', () => {
    const july = billingPeriod(u('2026-07-10T12:00:00Z'), TZ, 1)
    expect(computeBill(july, [], [v1], TZ, NOW, true).savings).toEqual({ baselineCents: 0, solarCents: 0, batteryCents: 0, demandCents: 0, baselinePeakKw: 0 })
  })
})
