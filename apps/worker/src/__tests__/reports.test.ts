/**
 * P5-01: the reports worker. Sections from the 15-minute intervals and the site's records, PDF
 * (HTML printed by Gotenberg), CSV and XLSX, runs with the creator's access, emailed links, and
 * weekly/monthly job schedulers in site time (a monthly one runs on the 1st at 07:00).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import ExcelJS from 'exceljs'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { extractText, getDocumentProxy } from 'unpdf'
import { Alert, Bill, Command, Device, Email, Interval15, Membership, Recommendation, Report, Site, fileInfo, initModels, readFileBuffer } from '@ecomanage/db'
import { nextReportRun, reportSchedulerId } from '@ecomanage/shared'
import { reportContent, type ReportInput } from '../reports/content'
import { reportCsv, reportHtml, reportXlsx } from '../reports/render'
import { hashToken, renderReportJob } from '../reports/run'
import { syncReportSchedules } from '../reports/schedules'
import { gotenbergPdf } from '../reports/pdf'
import type { Mailer, Message } from '../email/mailer'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_reports`
const REDIS = process.env.REDIS_TEST_URL || 'redis://redis:6379'
const GOTENBERG = process.env.GOTENBERG_URL || 'http://gotenberg:3000'
const TZ = 'America/Toronto'
const Q = 15 * 60_000
const siteId = new mongoose.Types.ObjectId()
const owner = new mongoose.Types.ObjectId()
const installer = new mongoose.Types.ObjectId()
const leaver = new mongoose.Types.ObjectId()
const deviceId = new mongoose.Types.ObjectId()
const NOW = new Date('2026-09-27T16:00:00Z')

const sent: Message[] = []
const mailer: Mailer = { send: async (m) => (sent.push(m), `<${sent.length}@test>`) }
const pdfs: string[] = []
const fakePdf = async (html: string) => (pdfs.push(html), Buffer.from('%PDF-fake'))
const deps = (now = NOW) => ({ pdf: fakePdf, mailer, appUrl: 'http://app.test/', now })

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  await Site.create({ _id: siteId, name: 'Maple Grove School', address: '12 Elm St', tz: TZ, currency: 'CAD', demandCapKw: 120 })
  await Membership.insertMany([
    { siteId, userId: owner, role: 'owner' },
    { siteId, userId: installer, role: 'installer' },
    { siteId, userId: leaver, role: 'manager', until: new Date('2026-09-01T04:00:00Z') },
  ])
  await Device.create({ _id: deviceId, siteId, type: 'heatpump', name: 'Heat pump', status: 'live' })
  // 21–22 Sep 2026 local (04:00Z = midnight EDT): two days of 96 intervals; one estimated.
  const start = Date.parse('2026-09-21T04:00:00Z')
  await Interval15.insertMany(
    Array.from({ length: 192 }, (_, i) => ({
      siteId,
      start: new Date(start + i * Q),
      pv: 1,
      used: 0.8,
      batt: i % 2 ? 0.5 : -0.5,
      grid: 2,
      export: 0.2,
      bld: 2,
      hp: 0.5,
      ev: 0.3,
      demandKw: i === 60 ? 111 : 8,
      costCents: { pk: 10, md: 5, op: 1 },
      creditCents: 1,
      quality: i === 5 ? 'estimated' : 'ok',
    }))
  )
  // The heat pump stopped reporting for 3 h on 21 Sep (of 48 h).
  await Alert.create({ siteId, deviceId: String(deviceId), ruleId: 'device-silent', severity: 'warning', title: 'Device not reporting', state: 'resolved', condition: 'cleared', openedAt: new Date('2026-09-21T14:00:00Z'), lastSeenAt: new Date('2026-09-21T17:00:00Z'), resolvedAt: new Date('2026-09-21T17:00:00Z'), resolution: { auto: true } })
  await Recommendation.create({ siteId, ruleId: 'peak-shaving', dedupeKey: 'k1', deviceId: String(deviceId), action: 'force_discharge', title: 'Discharge battery at 30 kW, 14:00–17:00', window: { start: new Date('2026-09-22T18:00:00Z'), end: new Date('2026-09-22T21:00:00Z') }, expectedSavingCents: 26_600, actualSavingCents: 21_000, status: 'verified', proposedAt: new Date('2026-09-22T16:30:00Z'), expiresAt: new Date('2026-09-22T17:45:00Z') })
  const cmd = await Command.create({ siteId, deviceId: String(deviceId), action: 'set_mode', params: {}, expiresAt: new Date('2026-09-22T20:00:00Z'), status: 'failed', error: 'Timed out' })
  await Command.collection.updateOne({ _id: cmd._id }, { $set: { createdAt: new Date('2026-09-22T15:00:00Z') } }) // mongoose sets createdAt itself
  await Bill.create({ siteId, period: '2026-09', start: new Date('2026-09-01T04:00:00Z'), end: new Date('2026-10-01T04:00:00Z'), lines: { energyPkCents: 100_000, energyMdCents: 50_000, energyOpCents: 10_000, demandCents: 155_400, fixedCents: 4_500, exportCreditCents: 2_000 }, totalCents: 317_900, peakKw: 111 })
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  sent.length = 0
  pdfs.length = 0
  await Promise.all([Report.deleteMany({}), Email.deleteMany({})])
})

const site = async () => (await Site.findById(siteId).lean())! as unknown as ReportInput['site']
const content = async (over: Partial<ReportInput> = {}) =>
  reportContent({ site: await site(), name: 'September review', from: '2026-09-21', to: '2026-09-22', sections: ['summary', 'sources', 'demand', 'cost', 'devices', 'decisions', 'alerts'], notes: '', money: true, now: NOW, ...over })
const section = (doc: Awaited<ReturnType<typeof content>>, id: string) => doc.sections.find((s) => s.id === id)!
const newReport = (over: object = {}) =>
  Report.create({ siteId, createdBy: owner, name: 'September review', from: '2026-09-21', to: '2026-09-22', sections: ['summary', 'cost'], format: 'csv', schedule: 'once', recipients: ['board@maplegrove.test', 'priya@maplegrove.test'], ...over })

describe('report content', () => {
  it('sums the local days and fills every section', async () => {
    const doc = await content()
    expect(doc).toMatchObject({ siteName: 'Maple Grove School', address: '12 Elm St', from: '2026-09-21', to: '2026-09-22', tz: TZ, currency: 'CAD' })
    const summary = section(doc, 'summary').blocks[0]
    expect(summary).toMatchObject({ kind: 'figures' })
    expect(Object.fromEntries((summary as { items: [string, string][] }).items)).toMatchObject({
      Consumption: '537.6 kWh', // (2 + 0.5 + 0.3) × 192
      'Solar produced': '192 kWh',
      'Bought from the grid': '384 kWh',
      'Self-sufficiency': '29%',
      'Highest 15-min demand': '111 kW · 2026-09-21 15:00',
      'Energy cost': '$28.80', // (10 + 5 + 1 − 1 credit) ¢ × 192
    })
    expect(section(doc, 'summary').blocks[1]).toEqual({ kind: 'note', text: '1 of 192 15-minute intervals are estimated (missing readings filled in).' })

    const sources = section(doc, 'sources').blocks[0] as { rows: unknown[][]; title: string }
    expect(sources.title).toBe('By day (kWh)')
    expect(sources.rows).toEqual([
      ['2026-09-21', 96, 24, 192, 19.2, 192, 48, 28.8],
      ['2026-09-22', 96, 24, 192, 19.2, 192, 48, 28.8],
      ['Total', 192, 48, 384, 38.4, 384, 96, 57.6],
    ])

    const demand = section(doc, 'demand').blocks
    expect((demand[0] as { items: [string, string][] }).items).toContainEqual(['Intervals at 90% of the cap or more', '1'])
    expect((demand[1] as { rows: unknown[][] }).rows[0]).toEqual(['2026-09-21 15:00', 111])

    const cost = section(doc, 'cost').blocks
    expect((cost[0] as { rows: unknown[][] }).rows).toContainEqual(['Energy - peak', '$19.20'])
    expect((cost[1] as { rows: unknown[][] }).rows[0]).toEqual(['2026-09 (in progress)', '$1,600.00', '$1,554.00', '$45.00', '-$20.00', '$3,179.00', 111])

    expect((section(doc, 'devices').blocks[0] as { rows: unknown[][] }).rows).toEqual([['Heat pump', 'heatpump', 'live', 3, '94%']])

    const decisions = section(doc, 'decisions').blocks
    expect((decisions[0] as { items: [string, string][] }).items).toEqual([
      ['Proposed', '1'],
      ['Approved and carried out', '1'],
      ['Declined', '0'],
      ['Expired', '0'],
      ['Measured saving', '$210.00'],
    ])
    expect((decisions[2] as { rows: unknown[][] }).rows).toEqual([['2026-09-22 11:00', 'Heat pump', 'set_mode', 'failed', 'Timed out']])

    expect((section(doc, 'alerts').blocks[1] as { rows: unknown[][] }).rows).toEqual([['2026-09-21 10:00', 'warning', 'Device not reporting', 'Heat pump', 'resolved', '2026-09-21 13:00', 'Cleared by itself']])
  })

  it('leaves out money for a creator who does not see it', async () => {
    const doc = await content({ money: false, sections: ['summary', 'cost', 'decisions'] })
    expect(JSON.stringify(doc)).not.toContain('$')
    expect(section(doc, 'cost').blocks).toEqual([{ kind: 'note', text: 'Energy cost is only included in reports made by the owner or a manager.' }])
  })

  it('says when there is nothing in the period, and uses months for long ranges', async () => {
    const empty = await content({ from: '2026-08-01', to: '2026-08-02', sections: ['summary', 'cost'] })
    expect(section(empty, 'summary').blocks).toContainEqual({ kind: 'note', text: 'No readings in this period.' })
    expect((section(empty, 'cost').blocks[0] as { rows: unknown[][] }).rows).toContainEqual(['Export credit', '$0.00']) // never "-$0.00"
    const long = await content({ from: '2026-06-01', to: '2026-09-30', sections: ['sources'] })
    expect((section(long, 'sources').blocks[0] as { title: string; rows: unknown[][] }).title).toBe('By month (kWh)')
    expect((section(long, 'sources').blocks[0] as { rows: unknown[][] }).rows[0][0]).toBe('2026-09')
  })
})

describe('report formats', () => {
  it('HTML escapes what people typed', async () => {
    const html = reportHtml(await content({ name: 'Board <b>report</b>', notes: '<script>alert(1)</script>', sections: ['summary'] }))
    expect(html).toContain('Board &lt;b&gt;report&lt;/b&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('21 Sep 2026 – 22 Sep 2026 · times in America/Toronto')
  })

  it('CSV has a block per section and never starts a cell with a formula', async () => {
    const csv = reportCsv(await content({ name: '=HYPERLINK("x")', notes: 'Line one, "quoted"', sections: ['summary', 'demand'] }))
    const lines = csv.split('\n')
    expect(lines[0]).toBe(`"'=HYPERLINK(""x"")"`)
    expect(lines).toContain('"Line one, ""quoted"""')
    expect(lines).toContain('# Energy summary')
    expect(lines).toContain('Consumption,537.6 kWh')
    expect(lines).toContain('Interval start,Demand (kW)')
    expect(lines).toContain('2026-09-21 15:00,111')
  })

  it('XLSX has a sheet per section with numbers as numbers', async () => {
    const wb = new ExcelJS.Workbook()
    const xlsx = await reportXlsx(await content({ sections: ['summary', 'sources'] }))
    await wb.xlsx.load(xlsx as unknown as Parameters<typeof wb.xlsx.load>[0]) // ExcelJS's types predate Node's generic Buffer
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Report', 'Energy summary', 'Sources and consumers'])
    const sources = wb.getWorksheet('Sources and consumers')!
    const values = sources.getSheetValues().filter(Boolean).map((r) => (r as unknown[]).slice(1))
    expect(values).toContainEqual(['Total', 192, 48, 384, 38.4, 384, 96, 57.6])
  })
})

describe('report runs', () => {
  it('renders a one-off report, stores it and emails each recipient a link once', async () => {
    const r = await newReport()
    const result = await renderReportJob({ reportId: String(r._id) }, deps())
    expect(result).toMatchObject({ status: 'ready', from: '2026-09-21', to: '2026-09-22', emailed: 2 })
    const done = (await Report.findById(r._id).lean())!
    expect(done).toMatchObject({ status: 'ready', error: null, lastRunAt: NOW })
    expect(done.files).toHaveLength(1)
    expect(await fileInfo(done.fileId!)).toMatchObject({ filename: 'september-review-2026-09-21-to-2026-09-22.csv', metadata: { siteId: String(siteId), kind: 'report', reportId: String(r._id) } })
    expect((await readFileBuffer(done.fileId!)).toString()).toContain('# Energy cost')

    expect(sent.map((m) => m.to)).toEqual(['board@maplegrove.test', 'priya@maplegrove.test'])
    expect(sent[0].subject).toBe('[Maple Grove School] September review')
    const token = /report-links\/([A-Za-z0-9_-]{43})/.exec(sent[0].text)![1]
    expect(done.files[0].tokenHash).toBe(hashToken(token))
    expect(done.files[0].linkExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000))
    expect(sent[0].text).toContain('until 27 Oct 2026')

    // A retry of the same period doesn't email again.
    await renderReportJob({ reportId: String(r._id) }, deps())
    expect(sent).toHaveLength(2)
  })

  it('prints PDFs from the report HTML', async () => {
    const r = await newReport({ format: 'pdf', recipients: [] })
    await renderReportJob({ reportId: String(r._id) }, deps())
    expect(pdfs).toHaveLength(1)
    expect(pdfs[0]).toContain('<h2>Energy cost</h2>')
    expect((await readFileBuffer((await Report.findById(r._id).lean())!.fileId!)).toString()).toBe('%PDF-fake')
  })

  it('covers the previous month on a monthly run, with the creator’s access', async () => {
    const r = await newReport({ schedule: 'monthly', createdBy: installer, sections: ['summary', 'cost'], recipients: [] })
    const run = await renderReportJob({ reportId: String(r._id), scheduled: true }, deps(new Date('2026-10-01T11:00:00Z')))
    expect(run).toMatchObject({ status: 'ready', from: '2026-09-01', to: '2026-09-30' })
    const csv = (await readFileBuffer((await Report.findById(r._id).lean())!.fileId!)).toString()
    expect(csv).toContain('Energy cost is only included in reports made by the owner or a manager.')
    expect(csv).not.toContain('$')
  })

  it('stops when the creator has left, and skips what is not due', async () => {
    const gone = await newReport({ createdBy: leaver })
    expect(await renderReportJob({ reportId: String(gone._id) }, deps())).toEqual({ status: 'failed', error: 'The person who made this report no longer has access to the site' })
    expect(await Report.findById(gone._id).lean()).toMatchObject({ status: 'failed', fileId: null })
    expect(sent).toHaveLength(0)

    const once = await newReport()
    expect(await renderReportJob({ reportId: String(once._id), scheduled: true }, deps())).toEqual({ status: 'skipped', reason: 'not a scheduled report' })
    const monthly = await newReport({ schedule: 'monthly' })
    expect(await renderReportJob({ reportId: String(monthly._id) }, deps())).toEqual({ status: 'skipped', reason: 'scheduled reports run on their schedule' })
    expect(await renderReportJob({ reportId: String(new mongoose.Types.ObjectId()) }, deps())).toEqual({ status: 'skipped', reason: 'report removed' })
  })

  it('records a rendering failure and lets the job retry', async () => {
    const r = await newReport({ format: 'pdf' })
    await expect(renderReportJob({ reportId: String(r._id) }, { ...deps(), pdf: async () => Promise.reject(new Error('PDF rendering failed (503)')) })).rejects.toThrow('PDF rendering failed (503)')
    expect(await Report.findById(r._id).lean()).toMatchObject({ status: 'failed', error: 'PDF rendering failed (503)' })
  })
})

describe('report schedules (BullMQ)', () => {
  let connection: Redis
  let queue: Queue

  beforeAll(async () => {
    connection = new Redis(REDIS, { maxRetriesPerRequest: null })
    queue = new Queue(`reports-test-${Date.now()}`, { connection })
  })

  afterAll(async () => {
    await queue.obliterate({ force: true })
    await queue.close()
    connection.disconnect()
  })

  it('runs a monthly report on the 1st at 07:00 site time', async () => {
    const monthly = await newReport({ schedule: 'monthly' })
    const weekly = await newReport({ schedule: 'weekly' })
    const now = new Date()
    expect(await syncReportSchedules(queue, now)).toMatchObject({ scheduled: 2, removed: 0 })

    const s = await queue.getJobScheduler(reportSchedulerId(String(monthly._id)))
    expect(s).toMatchObject({ pattern: '0 7 1 * *', tz: TZ, name: 'report' })
    // BullMQ's next run is the same instant: the coming 1st at 07:00 in Toronto.
    expect(new Date(Number(s!.next)).toISOString()).toBe(nextReportRun('monthly', TZ, now).toISOString())
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Number(s!.next)))
    expect(local).toBe('01, 07:00')
    const w = await queue.getJobScheduler(reportSchedulerId(String(weekly._id)))
    expect(new Date(Number(w!.next)).toISOString()).toBe(nextReportRun('weekly', TZ, now).toISOString())

    // A removed report loses its scheduler on the next sweep.
    await Report.deleteOne({ _id: weekly._id })
    expect(await syncReportSchedules(queue, now)).toMatchObject({ scheduled: 1, removed: 1 })
    expect((await queue.getJobSchedulers(0, -1)).map((x) => x.key)).toEqual([reportSchedulerId(String(monthly._id))])
  })

  it('queues a one-off report that never got its job, once', async () => {
    const r = await newReport()
    await Report.collection.updateOne({ _id: r._id }, { $set: { createdAt: new Date(Date.now() - 5 * 60_000) } })
    expect(await syncReportSchedules(queue)).toMatchObject({ queued: 1 })
    await syncReportSchedules(queue)
    expect((await queue.getJobs(['waiting', 'delayed'])).filter((j) => j.data.reportId === String(r._id))).toHaveLength(1)
  })
})

describe('Gotenberg', () => {
  it('prints the report HTML as a PDF', async () => {
    const up = await fetch(`${GOTENBERG}/health`).then((r) => r.ok).catch(() => false)
    if (!up) return // not running (outside the compose stack)
    const pdf = await gotenbergPdf(GOTENBERG)(reportHtml(await content({ sections: ['summary', 'demand'] })))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })
    expect(text).toContain('September review')
    expect(text).toContain('Highest 15-minute intervals')
  })
})
