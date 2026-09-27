/**
 * P4-05: History → Export CSV. Every 15-minute interval of the range in site time, cost columns
 * only for the roles that see money; big exports are emailed as a link once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Email, Export, Interval15, Site, fileInfo, initModels, readFileBuffer } from '@ecomanage/db'
import { exportCsvJob } from '../exports'
import { notifyExports } from '../email/notify'
import type { Mailer, Message } from '../email/mailer'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_exports`
const siteId = new mongoose.Types.ObjectId()
const userId = new mongoose.Types.ObjectId()
const Q = 15 * 60_000

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD' })
  await mongoose.connection.collection('users').insertOne({ _id: userId, email: 'jamie@test.example', name: 'Jamie Reyes' })
  // 24 Sep 2026, 00:00–00:45 local (04:00Z), plus one interval the day before that must not appear.
  await Interval15.insertMany([
    ...[0, 1, 2, 3].map((i) => ({
      siteId,
      start: new Date(Date.parse('2026-09-24T04:00:00Z') + i * Q),
      pv: 0,
      used: 0,
      batt: -0.5,
      grid: 1.25,
      export: 0,
      bld: 0.75,
      hp: 0,
      ev: 0,
      demandKw: 5,
      costCents: { pk: 0, md: 0, op: 11.25 },
      creditCents: 0,
      quality: i === 2 ? 'estimated' : 'ok',
    })),
    { siteId, start: new Date('2026-09-24T03:45:00Z'), grid: 9, quality: 'ok' },
  ])
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Export.deleteMany({}), Email.deleteMany({})])
})

const newExport = (over: object = {}) => Export.create({ siteId, userId, from: '2026-09-24', to: '2026-09-24', ...over })

describe('exportCsvJob', () => {
  it('writes every interval of the local days, with cost for managers', async () => {
    const e = await newExport({ includeCost: true })
    expect(await exportCsvJob({ exportId: String(e._id) })).toEqual({ rows: 4 })
    const done = await Export.findById(e._id).lean()
    expect(done).toMatchObject({ status: 'done', rows: 4, error: null })
    const info = await fileInfo(done!.fileId!)
    expect(info).toMatchObject({ filename: 'energy-2026-09-24-to-2026-09-24.csv', metadata: { siteId: String(siteId), kind: 'export' } })
    const lines = (await readFileBuffer(done!.fileId!)).toString().trim().split('\n')
    expect(lines[0]).toBe('local_start,utc_start,solar_kwh,solar_used_kwh,battery_kwh,grid_import_kwh,export_kwh,building_kwh,heat_pump_kwh,ev_kwh,demand_kw,energy_cost_cad,export_credit_cad,quality')
    expect(lines[1]).toBe('2026-09-24T00:00:00-04:00,2026-09-24T04:00:00.000Z,0.000,0.000,-0.500,1.250,0.000,0.750,0.000,0.000,5.0,0.11,0.00,ok')
    expect(lines[3].endsWith(',estimated')).toBe(true)
    expect(lines).toHaveLength(5)
  })

  it('leaves out money for installers, and records a failure', async () => {
    const e = await newExport({ includeCost: false })
    await exportCsvJob({ exportId: String(e._id) })
    const header = (await readFileBuffer((await Export.findById(e._id).lean())!.fileId!)).toString().split('\n')[0]
    expect(header).not.toMatch(/cost|credit/)
    const orphan = await Export.create({ siteId: new mongoose.Types.ObjectId(), userId, from: '2026-09-24', to: '2026-09-24' })
    await expect(exportCsvJob({ exportId: String(orphan._id) })).rejects.toThrow('The site no longer exists')
    expect(await Export.findById(orphan._id).lean()).toMatchObject({ status: 'failed', error: 'The site no longer exists' })
    expect(await exportCsvJob({ exportId: String(new mongoose.Types.ObjectId()) })).toEqual({ rows: 0 })
  })
})

describe('notifyExports', () => {
  it('emails a big export once when it is ready, with a link to History', async () => {
    const sent: Message[] = []
    const mailer: Mailer = { send: async (m) => (sent.push(m), `<${sent.length}@test>`) }
    const big = await newExport({ status: 'done', large: true, rows: 58_000, from: '2025-01-01' })
    await newExport({ status: 'done', large: false })
    await newExport({ status: 'queued', large: true })
    expect(await notifyExports(mailer, 'http://app.test')).toBe(1)
    expect(await notifyExports(mailer, 'http://app.test')).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'jamie@test.example', subject: '[Maple Grove School] Your export for 2025-01-01 to 2026-09-24 is ready' })
    expect(sent[0].text).toContain('(58,000 rows)')
    expect(sent[0].text).toContain(`Download it from History: http://app.test/history?export=${big._id}`)
  })
})
