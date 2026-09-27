import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import {
  AuditEvent,
  Device,
  DeviceProfile,
  Interval15,
  Membership,
  Site,
  SiteModel,
  Telemetry,
  TELEMETRY_TTL_SECONDS,
  initModels,
  recordAudit,
} from '../index'

const URL = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_db_models`

beforeAll(async () => {
  await mongoose.connect(URL, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

const collectionInfo = async (name: string) => {
  const [info] = await mongoose.connection.db!.listCollections({ name }).toArray()
  return info as { type?: string; options?: Record<string, unknown> } | undefined
}

describe('collections', () => {
  it('creates telemetry as a time-series collection with 13-month expiry', async () => {
    const info = await collectionInfo('telemetry')
    expect(info?.type).toBe('timeseries')
    expect(info?.options?.timeseries).toMatchObject({ timeField: 'ts', metaField: 'meta', granularity: 'seconds' })
    expect(info?.options?.expireAfterSeconds).toBe(TELEMETRY_TTL_SECONDS)
  })

  it('is safe to run initModels again', async () => {
    await expect(initModels()).resolves.toBeUndefined()
  })

  it('uses the collection names from the plan', async () => {
    const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['sites', 'memberships', 'invites', 'devices', 'deviceProfiles', 'telemetry', 'intervals15', 'siteModels', 'auditEvents'])
    )
  })
})

describe('constraints', () => {
  const siteId = new mongoose.Types.ObjectId()
  const userId = new mongoose.Types.ObjectId()

  it('allows one membership per user and site', async () => {
    await Membership.create({ userId, siteId, role: 'owner' })
    await expect(Membership.create({ userId, siteId, role: 'manager' })).rejects.toMatchObject({ code: 11000 })
    await expect(Membership.create({ userId, siteId: new mongoose.Types.ObjectId(), role: 'nobody' as never })).rejects.toThrow(/role/)
  })

  it('keeps one site model per version, with three-number positions (P4-03)', async () => {
    const model = { siteId, source: 'generated' as const, hub: [0, 1, 2], anchors: [{ key: 'pv', at: [0, 2, 0], label: [1, 3, 0] }], buildingLabel: [0, 3, 0] }
    await SiteModel.create({ ...model, version: 1 })
    await expect(SiteModel.create({ ...model, version: 1 })).rejects.toMatchObject({ code: 11000 })
    await expect(SiteModel.create({ ...model, version: 2, hub: [0, 1] })).rejects.toThrow(/hub/)
    await expect(SiteModel.create({ ...model, version: 3, anchors: [{ key: 'wind' as never, at: [0, 0, 0], label: [0, 0, 0] }] })).rejects.toThrow(/key/)
    expect((await SiteModel.create({ ...model, version: 4 })).toObject().camera).toEqual({ view: 'fit' })
  })

  it('allows one interval per site and start', async () => {
    const start = new Date('2026-09-24T16:30:00Z')
    await Interval15.create({ siteId, start, pv: 5 })
    await expect(Interval15.create({ siteId, start, pv: 6 })).rejects.toMatchObject({ code: 11000 })
  })

  it('keeps device profile ids unique', async () => {
    const p = { id: 'test@1', vendor: 'v', model: 'm', protocol: 'modbus-tcp', deviceTypes: ['pv' as const] }
    await DeviceProfile.create(p)
    await expect(DeviceProfile.create(p)).rejects.toMatchObject({ code: 11000 })
  })

  it('validates device types and statuses and defaults to pending', async () => {
    const d = await Device.create({ siteId, type: 'pv', name: 'Inverter A' })
    expect(d.status).toBe('pending')
    await expect(Device.create({ siteId, type: 'wind' as never, name: 'Turbine' })).rejects.toThrow(/type/)
  })

  it('validates the site bill day', async () => {
    await expect(Site.create({ name: 'x', billDay: 31 })).rejects.toThrow(/billDay/)
  })
})

describe('telemetry and audit', () => {
  it('stores readings with their metadata', async () => {
    const meta = { siteId: new mongoose.Types.ObjectId(), deviceId: new mongoose.Types.ObjectId() }
    await Telemetry.insertMany([
      { ts: new Date('2026-09-24T16:40:00Z'), meta, p_kw: 36.1, e_out_kwh: 1000.5 },
      { ts: new Date('2026-09-24T16:40:05Z'), meta, p_kw: 36.3, q: 'backfilled' },
    ])
    const rows = await Telemetry.find({ 'meta.deviceId': meta.deviceId }).sort({ ts: 1 }).lean()
    expect(rows.map((r) => [r.p_kw, r.q])).toEqual([
      [36.1, 'ok'],
      [36.3, 'backfilled'],
    ])
  })

  it('records audit events with copies of before and after', async () => {
    const siteId = new mongoose.Types.ObjectId()
    const after = { name: 'Roof east' }
    await recordAudit({ siteId, userId: null, action: 'device.update', target: 'device:1', before: { name: 'A' }, after })
    after.name = 'changed later'
    const [ev] = await AuditEvent.find({ siteId }).lean()
    expect(ev).toMatchObject({ action: 'device.update', before: { name: 'A' }, after: { name: 'Roof east' }, userId: null })
    await recordAudit({ siteId, userId: null, action: 'x', target: 'y' })
    expect((await AuditEvent.findOne({ siteId, action: 'x' }).lean())?.before).toBeNull()
  })
})
