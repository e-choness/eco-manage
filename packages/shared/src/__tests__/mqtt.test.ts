import { describe, expect, it } from 'vitest'
import {
  commandAckMessage,
  commandMessage,
  deviceStatusMessage,
  gatewayStatusMessage,
  isBackfill,
  jobMessage,
  jobResultMessage,
  parseTopic,
  readingsOf,
  subscriptions,
  telemetryMessage,
  topics,
} from '../mqtt'

const S = '650000000000000000000001'

describe('topics', () => {
  it('builds every topic and parses it back', () => {
    expect(parseTopic(topics.telemetry(S, 'invA'))).toEqual({ kind: 'telemetry', siteId: S, deviceId: 'invA' })
    expect(parseTopic(topics.deviceStatus(S, 'invA'))).toEqual({ kind: 'deviceStatus', siteId: S, deviceId: 'invA' })
    expect(parseTopic(topics.gatewayStatus(S))).toEqual({ kind: 'gatewayStatus', siteId: S })
    expect(parseTopic(topics.command(S, 'c1'))).toEqual({ kind: 'command', siteId: S, commandId: 'c1' })
    expect(parseTopic(topics.commandAck(S, 'c1'))).toEqual({ kind: 'commandAck', siteId: S, commandId: 'c1' })
    expect(parseTopic(topics.job(S, 'j1'))).toEqual({ kind: 'job', siteId: S, jobId: 'j1' })
    expect(parseTopic(topics.jobResult(S, 'j1'))).toEqual({ kind: 'jobResult', siteId: S, jobId: 'j1' })
  })

  it('rejects anything else', () => {
    for (const t of [
      'other/x/dev/a/telemetry',
      'site/x',
      'site/x/dev/a/other',
      'site/x/dev/a',
      'site/x/gw/other',
      'site/x/cmd/c1/result',
      'site/x/job/j1/ack',
      'site/x/cmd/c1/ack/extra',
      'site/x/unknown/a',
      'site/x y/dev/a/telemetry',
      'site//dev/a/telemetry',
    ]) {
      expect(parseTopic(t)).toBeNull()
    }
  })

  it('lists the filters each side subscribes to', () => {
    expect(subscriptions.ingest).toContain('site/+/dev/+/telemetry')
    expect(subscriptions.gatewayInbox(S)).toEqual([`site/${S}/cmd/+`, `site/${S}/job/+`, `site/${S}/config`])
  })
})

describe('payloads', () => {
  const reading = { ts: '2026-09-24T16:40:03Z', p_kw: -20, soc_pct: 68.2, reserve_pct: 20, t_c: 27.4 }

  it('accepts single readings and batches, defaulting quality to ok', () => {
    const one = telemetryMessage.parse(reading)
    expect(readingsOf(one)).toEqual([{ ...reading, q: 'ok' }])
    const batch = telemetryMessage.parse({ items: [reading, { ...reading, q: 'backfilled' }] })
    expect(readingsOf(batch).map((r) => r.q)).toEqual(['ok', 'backfilled'])
  })

  it('rejects unknown fields and bad values', () => {
    expect(telemetryMessage.safeParse({ ...reading, extra: 1 }).success).toBe(false)
    expect(telemetryMessage.safeParse({ ...reading, soc_pct: 140 }).success).toBe(false)
    expect(telemetryMessage.safeParse({ ...reading, ts: 'yesterday' }).success).toBe(false)
    expect(telemetryMessage.safeParse({ items: [] }).success).toBe(false)
  })

  it('validates status, command, ack and job messages', () => {
    expect(deviceStatusMessage.parse({ ts: reading.ts, state: 'running' }).fault).toEqual([])
    expect(
      gatewayStatusMessage.safeParse({ ts: reading.ts, fw: '1.4.2', uptimeS: 10, buffered: 0, oldestBufferedTs: null, clockOffsetMs: 3 })
        .success
    ).toBe(true)
    expect(
      commandMessage.parse({ deviceId: 'bat', action: 'set_reserve', expiresAt: reading.ts, revertAt: null }).params
    ).toEqual({})
    expect(commandAckMessage.safeParse({ ok: false, error: 'expired', ts: reading.ts }).success).toBe(true)
    expect(jobMessage.safeParse({ type: 'scan' }).success).toBe(true)
    expect(jobMessage.safeParse({ type: 'format-disk' }).success).toBe(false)
    expect(jobResultMessage.parse({ ok: true, ts: reading.ts }).data).toEqual({})
  })

  it('marks readings older than 15 minutes on arrival as backfill', () => {
    const ts = new Date('2026-09-24T12:00:00Z')
    expect(isBackfill(ts, new Date('2026-09-24T12:15:00Z'))).toBe(false)
    expect(isBackfill(ts, new Date('2026-09-24T12:15:01Z'))).toBe(true)
  })
})
