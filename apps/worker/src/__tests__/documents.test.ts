/**
 * P2-05: statement PDFs and utility bill extraction. PDFs are generated with pdfkit and read back
 * with the same text extraction the worker uses on uploads.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import PDFDocument from 'pdfkit'
import { Bill, Site, Tariff, fileInfo, initModels, putFile, readFileBuffer } from '@ecomanage/db'
import { TARIFF_TEMPLATES } from '@ecomanage/shared'
import { refreshBill } from '../billing'
import { pdfText, renderStatement, statementJob, totalFromCsv, totalFromText, utilityBillJob } from '../documents'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_docs`
const TZ = 'America/Toronto'
const siteId = new mongoose.Types.ObjectId()
const sid = String(siteId)
const NOW = new Date('2026-10-05T12:00:00Z')

const pdfWith = (lines: string[]): Promise<Buffer> => {
  const doc = new PDFDocument()
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))))
  for (const l of lines) doc.text(l)
  doc.end()
  return done
}

const closedBill = {
  siteId,
  period: '2026-09',
  start: new Date('2026-09-01T04:00:00Z'),
  end: new Date('2026-10-01T04:00:00Z'),
  inProgress: false,
  lines: { energyPkCents: 1290, energyMdCents: 160, energyOpCents: 108, demandCents: 140_000, fixedCents: 9000, exportCreditCents: 10 },
  energyKwh: { pk: 45, md: 10, op: 12, export: 2 },
  totalCents: 150_548,
  peakKw: 100,
  peakAt: new Date('2026-09-17T19:15:00Z'),
  tariffVersion: 1,
  tariffVersions: [1],
  intervals: 5,
  estimatedShare: 0.2,
  savedCents: 28_522,
  computedAt: NOW,
}

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
  await Promise.all([Site.deleteMany({}), Tariff.deleteMany({}), Bill.deleteMany({})])
  await Site.create({ _id: siteId, name: 'Maple Grove School', address: '12 Maple Grove Rd, Toronto', tz: TZ, billDay: 1, currency: 'CAD' })
  await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-08-01' })
  await Bill.create(closedBill)
})

describe('totalFromText', () => {
  it('finds the amount due, preferring it over subtotals', () => {
    expect(totalFromText('Account 1234\nTotal Amount Due $3,412.50\nDue by Oct 20')).toBe(341_250)
    expect(totalFromText('Delivery 900.00 Total 1,000.00 HST 130.00 Amount due: $1,130.00')).toBe(113_000)
    expect(totalFromText('Total new charges\n  $ 2,004.10')).toBe(200_410)
    expect(totalFromText('Total 88.40')).toBe(8840)
  })

  it('returns null when there is no amount', () => {
    expect(totalFromText('Thank you for your payment.')).toBeNull()
    expect(totalFromText('Total kWh 1234')).toBeNull()
  })
})

describe('totalFromCsv (template)', () => {
  it('takes the row for the period', () => {
    expect(totalFromCsv('period,total_due\n2026-08,"1,411.20"\n2026-09,1498.20\n', '2026-09')).toBe(149_820)
  })

  it('takes the only row when there is no period column', () => {
    expect(totalFromCsv('Account,Total\r\n1234,$1498.20\r\n', '2026-09')).toBe(149_820)
  })

  it('returns null without a total column, a matching row or a number', () => {
    expect(totalFromCsv('period,kwh\n2026-09,1200', '2026-09')).toBeNull()
    expect(totalFromCsv('period,total_due\n2026-08,1411.20', '2026-09')).toBeNull()
    expect(totalFromCsv('total_due\nn/a', '2026-09')).toBeNull()
    expect(totalFromCsv('', '2026-09')).toBeNull()
  })
})

describe('statement', () => {
  it('renders the bill lines, total and facts', async () => {
    const bill = (await Bill.findOne({ siteId }).lean())!
    const pdf = await renderStatement({ site: { name: 'Maple Grove School', tz: TZ, currency: 'CAD' }, bill, tariff: { version: 1, name: 'Commercial TOU-D', demandRateCents: 1400 } }, NOW)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const text = (await pdfText(pdf)).replace(/\s+/g, ' ')
    for (const s of [
      'Energy statement',
      'Maple Grove School',
      'Billing period 1 Sept 2026 - 30 Sept 2026',
      'Energy - peak (45.0 kWh) $12.90',
      'Demand - 100.0 kW x $14.00/kW $1,400.00',
      'Export credit (2.0 kWh) -$0.10',
      'Total $1,505.48',
      'Commercial TOU-D, version 1',
      '100.0 kW at 17 Sept, 15:15',
      'Saved vs grid only $285.22',
    ])
      expect(text).toContain(s)
  })

  it('stores the rendered PDF and remembers it on the bill', async () => {
    const { fileId } = await statementJob({ siteId: sid, period: '2026-09' }, NOW)
    expect(await fileInfo(fileId)).toMatchObject({ filename: 'statement-2026-09.pdf', metadata: { siteId: sid, kind: 'statement' } })
    expect((await Bill.findOne({ siteId }).lean())!.statement).toEqual({ fileId, renderedAt: NOW })
    expect((await readFileBuffer(fileId)).subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('utility bill job', () => {
  const upload = async (data: Buffer, contentType: string) => {
    const fileId = await putFile('bill', data, { siteId: sid, kind: 'utility-bill', contentType })
    await Bill.updateOne({ siteId }, { $set: { utility: { status: 'processing', fileId, fileName: 'bill' } } })
    return fileId
  }

  it('reads the total from a PDF and stores the difference', async () => {
    const fileId = await upload(await pdfWith(['Toronto Hydro', 'Delivery 312.40', 'Total Amount Due $1,498.20']), 'application/pdf')
    expect(await utilityBillJob({ siteId: sid, period: '2026-09', fileId }, NOW)).toEqual({ status: 'done', totalCents: 149_820 })
    expect((await Bill.findOne({ siteId }).lean())!.utility).toMatchObject({ status: 'done', totalCents: 149_820, diffCents: 728, source: 'pdf', parsedAt: NOW })
  })

  it('reads the CSV template', async () => {
    const fileId = await upload(Buffer.from('period,total_due\n2026-09,1498.20\n'), 'text/csv')
    await utilityBillJob({ siteId: sid, period: '2026-09', fileId }, NOW)
    expect((await Bill.findOne({ siteId }).lean())!.utility).toMatchObject({ status: 'done', totalCents: 149_820, source: 'csv' })
  })

  it('marks the upload failed when there is no total, so the owner can type it in', async () => {
    const fileId = await upload(await pdfWith(['Thank you for your payment.']), 'application/pdf')
    expect(await utilityBillJob({ siteId: sid, period: '2026-09', fileId }, NOW)).toEqual({ status: 'failed', totalCents: null })
    const u = (await Bill.findOne({ siteId }).lean())!.utility!
    expect(u).toMatchObject({ status: 'failed', error: expect.stringMatching(/Type the total in/) })
    expect(u.totalCents).toBeUndefined()
  })

  it('leaves the bill alone when a newer upload replaced this one', async () => {
    const old = await upload(Buffer.from('total_due\n1.00'), 'text/csv')
    await Bill.updateOne({ siteId }, { $set: { utility: { status: 'manual', totalCents: 150_000, diffCents: 548, source: 'manual' } } })
    await utilityBillJob({ siteId: sid, period: '2026-09', fileId: old }, NOW)
    expect((await Bill.findOne({ siteId }).lean())!.utility).toMatchObject({ status: 'manual', totalCents: 150_000 })
  })
})

describe('bill recompute keeps the utility comparison current', () => {
  it('updates diffCents when our total changes, and leaves a bill without one alone', async () => {
    const site = (await Site.findById(siteId).lean())!
    await Bill.updateOne({ siteId }, { $set: { utility: { status: 'manual', totalCents: 9000, diffCents: 0, source: 'manual' } } })
    // No intervals any more: the recomputed bill is just the fixed fee, 9000
    const bill = await refreshBill(site, new Date('2026-09-10T12:00:00Z'), NOW)
    expect(bill.totalCents).toBe(9000)
    expect(bill.utility).toMatchObject({ status: 'manual', totalCents: 9000, diffCents: 0 })
    await Bill.updateOne({ siteId }, { $set: { 'utility.totalCents': 8000 } })
    expect((await refreshBill(site, new Date('2026-09-10T12:00:00Z'), NOW)).utility!.diffCents).toBe(1000)

    const august = await refreshBill(site, new Date('2026-08-10T12:00:00Z'), NOW)
    expect(august.utility ?? null).toBeNull()
  })
})
