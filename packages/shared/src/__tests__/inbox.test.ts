/**
 * P3-06: the Inbox cursor and order. The API's tests cover paging against the database.
 */
import { describe, expect, it } from 'vitest'
import { decodeInboxCursor, encodeInboxCursor, inboxOrder, inboxQuery } from '../index'

describe('inbox cursor', () => {
  it('round-trips the time and key, URL-safe', () => {
    const c = encodeInboxCursor('2026-09-24T16:12:00.000Z', 'alert:66f2c0ffee0000000000abcd')
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeInboxCursor(c)).toEqual({ at: '2026-09-24T16:12:00.000Z', key: 'alert:66f2c0ffee0000000000abcd' })
  })

  it('refuses anything else', () => {
    expect(decodeInboxCursor('%%%')).toBeNull() // not base64
    expect(decodeInboxCursor(btoa('no-separator'))).toBeNull()
    expect(decodeInboxCursor(btoa('yesterday|alert:1'))).toBeNull()
  })
})

describe('inboxOrder', () => {
  it('puts the newest first, and same-moment items by key', () => {
    const items = [
      { at: '2026-09-24T16:00:00.000Z', key: 'alert:a' },
      { at: '2026-09-24T16:05:00.000Z', key: 'alert:b' },
      { at: '2026-09-24T16:00:00.000Z', key: 'decide:c' },
      { at: '2026-09-24T16:00:00.000Z', key: 'alert:a' },
    ]
    expect([...items].sort(inboxOrder).map((i) => i.key)).toEqual(['alert:b', 'decide:c', 'alert:a', 'alert:a'])
  })
})

describe('inboxQuery', () => {
  it('defaults to every open item, 30 at a time', () => {
    expect(inboxQuery.parse({})).toEqual({ state: 'open', type: 'all', limit: 30 })
    expect(inboxQuery.safeParse({ limit: '500' }).success).toBe(false)
  })
})
