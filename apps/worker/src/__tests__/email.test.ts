/**
 * P2-09: alert emails with quiet hours, escalation to the owner, and the 07:00 daily summary.
 * A recording mailer checks who gets what; one test sends through the compose Mailpit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { Alert, Email, Interval15, Membership, NotificationPrefs, Site, Tariff, initModels } from '@ecomanage/db'
import { TARIFF_TEMPLATES } from '@ecomanage/shared'
import { createMailer, type Mailer, type Message } from '../email/mailer'
import { dailySummaries, notifyAlerts, sendOnce } from '../email/notify'

const MONGO = `${process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017'}/ecomanage_test_worker_email`
const MAILPIT = process.env.MAILPIT_URL || 'http://mailpit:8025'
const APP = 'http://app.test'
const siteId = new mongoose.Types.ObjectId()
const ids = { owner: new mongoose.Types.ObjectId(), manager: new mongoose.Types.ObjectId(), installer: new mongoose.Types.ObjectId(), former: new mongoose.Types.ObjectId() }
const NOON = new Date('2026-09-24T16:00:00Z') // Thu 12:00 EDT
const NIGHT = new Date('2026-09-25T03:00:00Z') // 23:00 EDT
const MIN = 60_000

const mailer = () => {
  const sent: Message[] = []
  let failNext = false
  const m: Mailer & { sent: Message[]; failNext: () => void } = {
    sent,
    failNext: () => (failNext = true),
    async send(msg) {
      if (failNext) {
        failNext = false
        throw new Error('SMTP down')
      }
      sent.push(msg)
      return `<${sent.length}@test>`
    },
  }
  return m
}
const to = (m: { sent: Message[] }) => m.sent.filter((s) => !s.subject.includes('Not acknowledged')).map((s) => s.to).sort()

const alert = (over: object = {}) =>
  Alert.create({
    siteId,
    deviceId: 'ev3',
    ruleId: 'device-silent',
    severity: 'warning',
    title: 'Device not reporting',
    detail: 'EV charger 3: no data for 7 min',
    state: 'open',
    condition: 'active',
    openedAt: new Date(NOON.getTime() - 2 * MIN),
    lastSeenAt: NOON,
    ...over,
  })

beforeAll(async () => {
  await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 5000 })
  await mongoose.connection.dropDatabase()
  await initModels()
  await Site.create({ _id: siteId, name: 'Maple Grove School', tz: 'America/Toronto', currency: 'CAD' })
  await mongoose.connection.collection('users').insertMany([
    { _id: ids.owner, email: 'priya@test.example', name: 'Priya Shah' },
    { _id: ids.manager, email: 'jamie@test.example', name: 'Jamie Reyes' },
    { _id: ids.installer, email: 'north@test.example', name: 'Northside Solar' },
    { _id: ids.former, email: 'gone@test.example', name: 'Former' },
  ])
  await Membership.create([
    { userId: ids.owner, siteId, role: 'owner' },
    { userId: ids.manager, siteId, role: 'manager' },
    { userId: ids.installer, siteId, role: 'installer' },
    { userId: ids.former, siteId, role: 'manager', until: new Date('2026-01-01') },
  ])
  // Jamie: no alert emails (failures stay on for managers); installer: no quiet hours, no failures.
  await NotificationPrefs.create([
    { userId: ids.manager, siteId, email: 'jamie@test.example', alerts: false, failures: false },
    { userId: ids.installer, siteId, email: 'north@test.example', quietFrom: null, quietTo: null, failures: false, daily: false },
  ])
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})

beforeEach(async () => {
  await Promise.all([Alert.deleteMany({}), Email.deleteMany({}), Interval15.deleteMany({}), Tariff.deleteMany({})])
})

describe('alert emails', () => {
  it('go once to each member who wants warnings', async () => {
    const m = mailer()
    const a = await alert()
    expect(await notifyAlerts(m, APP, NOON)).toEqual({ alerts: 2, escalations: 0 })
    expect(to(m)).toEqual(['north@test.example', 'priya@test.example'])
    expect(m.sent[0]).toMatchObject({ subject: '[Maple Grove School] Device not reporting', text: expect.stringContaining(`${APP}/inbox?alert=${a._id}`) })
    expect(m.sent[0].text).toContain('EV charger 3: no data for 7 min.')
    expect(m.sent[0].html).toContain('<a href="http://app.test/inbox?alert=')
    expect(await notifyAlerts(m, APP, new Date(NOON.getTime() + MIN))).toEqual({ alerts: 0, escalations: 0 })
    expect(await Email.countDocuments({ kind: 'alert', status: 'sent' })).toBe(2)
  })

  it('skip info alerts and paused ones', async () => {
    const m = mailer()
    await alert({ ruleId: 'command-ack-slow', severity: 'info', condition: 'cleared' })
    await alert({ deviceId: 'ev4', snoozedUntil: new Date(NOON.getTime() + 60 * MIN) })
    await notifyAlerts(m, APP, NOON)
    expect(m.sent).toEqual([])
  })

  it('send command failures to owners and managers always, even in quiet hours', async () => {
    const m = mailer()
    await alert({ ruleId: 'command-failed', condition: 'cleared', openedAt: new Date(NIGHT.getTime() - MIN), detail: 'Battery: restart failed' })
    await notifyAlerts(m, APP, NIGHT)
    expect(to(m)).toEqual(['jamie@test.example', 'priya@test.example'])
  })

  it('hold warnings in quiet hours until they end', async () => {
    const m = mailer()
    await alert({ openedAt: new Date(NIGHT.getTime() - MIN) })
    await notifyAlerts(m, APP, NIGHT)
    expect(to(m)).toEqual(['north@test.example']) // no quiet hours set
    await notifyAlerts(m, APP, new Date('2026-09-25T10:31:00Z')) // 06:31 EDT
    expect(to(m)).toEqual(['north@test.example', 'priya@test.example'])
  })

  it('stop for former members', async () => {
    const m = mailer()
    await alert()
    await notifyAlerts(m, APP, NOON)
    expect(to(m)).not.toContain('gone@test.example')
  })

  it('are retried when sending fails', async () => {
    const m = mailer()
    await alert()
    m.failNext()
    await expect(notifyAlerts(m, APP, NOON)).rejects.toThrow('SMTP down')
    await notifyAlerts(m, APP, NOON)
    expect(to(m)).toEqual(['north@test.example', 'priya@test.example'])
  })
})

describe('escalation', () => {
  it('emails the owner once when nobody acknowledged in 30 minutes', async () => {
    const m = mailer()
    await alert({ openedAt: new Date(NOON.getTime() - 29 * MIN) })
    expect((await notifyAlerts(m, APP, NOON)).escalations).toBe(0)
    const later = new Date(NOON.getTime() + 2 * MIN)
    expect((await notifyAlerts(m, APP, later)).escalations).toBe(1)
    expect(m.sent.at(-1)).toMatchObject({ to: 'priya@test.example', subject: '[Maple Grove School] Not acknowledged for 31 min: Device not reporting' })
    expect((await notifyAlerts(m, APP, new Date(later.getTime() + 10 * MIN))).escalations).toBe(0)
  })

  it('does not escalate an acknowledged alert', async () => {
    const m = mailer()
    await alert({ state: 'ack', openedAt: new Date(NOON.getTime() - 60 * MIN) })
    expect((await notifyAlerts(m, APP, NOON)).escalations).toBe(0)
  })
})

describe('daily summary', () => {
  const SEVEN = new Date('2026-09-25T11:05:00Z') // Fri 07:05 EDT

  it('sends yesterday’s cost, peak and savings at 07:00 site time, once', async () => {
    await Tariff.create({ ...TARIFF_TEMPLATES[0].tariff, siteId, version: 1, validFrom: '2026-01-01' })
    // Thu 24 Sep: 15:15 EDT peak 20 kWh at 27¢ (540), 12:00 mid 10 kWh at 16¢ with 2 kWh exported (160 − 10)
    await Interval15.create([
      { siteId, start: new Date('2026-09-24T19:15:00Z'), grid: 20, demandKw: 80, pv: 5 },
      { siteId, start: new Date('2026-09-24T16:00:00Z'), grid: 10, export: 2, pv: 12, demandKw: 40 },
    ])
    await alert({ openedAt: new Date('2026-09-25T10:00:00Z') })
    const m = mailer()
    expect(await dailySummaries(m, APP, new Date('2026-09-25T10:55:00Z'))).toBe(0) // 06:55
    expect(await dailySummaries(m, APP, SEVEN)).toBe(2) // owner and manager; installer turned it off
    expect(to(m)).toEqual(['jamie@test.example', 'priya@test.example'])
    const mail = m.sent[0]
    expect(mail.subject).toBe('[Maple Grove School] Yesterday: $6.90')
    expect(mail.text).toContain('Thursday 24 September at Maple Grove School:')
    expect(mail.text).toContain('Energy cost $6.90 for 30 kWh from the grid.')
    expect(mail.text).toContain('Peak demand 80 kW at 15:15.')
    // Savings need 7 days of data in the bill; the day summary shows them from the first day:
    // solar used (5 × 27 + 10 × 16) + credit 10 = 305
    expect(mail.text).toContain('Solar and battery saved $3.05.')
    expect(mail.text).toContain('Open alerts (1): EV charger 3: no data for 7 min.')
    expect(await dailySummaries(m, APP, new Date('2026-09-25T11:35:00Z'))).toBe(0)
    expect(await dailySummaries(m, APP, new Date('2026-09-25T13:00:00Z'))).toBe(0) // 09:00
  })

  it('says so when there was no data', async () => {
    const m = mailer()
    await dailySummaries(m, APP, SEVEN)
    expect(m.sent[0].text).toContain('Thursday 24 September at Maple Grove School: no meter data for the day.')
    expect(m.sent[0].text).toContain('No open alerts.')
  })
})

describe('SMTP', () => {
  it('delivers through Mailpit, once per key', async () => {
    const address = `smtp-${Date.now()}@test.example`
    const smtp = createMailer(process.env.SMTP_TEST_URL || 'smtp://mailpit:1025', 'EcoManage <alerts@ecomanage.local>')
    const msg = { to: address, subject: 'EcoManage test', text: 'Hello', html: '<p>Hello</p>' }
    const claim = { key: `test:${address}`, siteId: String(siteId), userId: null, kind: 'alert' as const }
    expect(await sendOnce(smtp, claim, msg, NOON)).toBe(true)
    expect(await sendOnce(smtp, claim, msg, NOON)).toBe(false)
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json()) as { messages_count: number; messages: object[] }
    expect(found.messages_count).toBe(1)
    expect(found.messages[0]).toMatchObject({ Subject: 'EcoManage test', From: { Address: 'alerts@ecomanage.local' } })
    expect(await Email.findOne({ key: claim.key }).lean()).toMatchObject({ status: 'sent', messageId: expect.any(String) })
  })
})
