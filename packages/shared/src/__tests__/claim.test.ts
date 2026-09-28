/**
 * P5-04: claiming a gateway — the QR text, claim codes and the proof in a certificate request.
 */
import { describe, expect, it } from 'vitest'
import { claimCodeFrom, claimTopics, formatClaimCode, gatewayClaimInput, gatewayQr, isClaimCode, normalizeClaimCode, parseGatewayQr } from '../index'
import { claimKey, claimProof, codeMatches, proofMatches } from '../claimProof'

const CODE = 'K7Q2M9XH4TWR8ZB5N3CD'

describe('claim codes', () => {
  it('come from random bytes as 20 characters without look-alikes', () => {
    const code = claimCodeFrom(new Uint8Array(16).fill(0xa5))
    expect(code).toHaveLength(20)
    expect(isClaimCode(code)).toBe(true)
    expect(code).not.toMatch(/[ILOU]/)
    expect(claimCodeFrom(new Uint8Array(16))).toBe('0'.repeat(20))
  })

  it('read the same typed in groups, in lower case or with I, L and O', () => {
    expect(formatClaimCode(CODE)).toBe('K7Q2-M9XH-4TWR-8ZB5-N3CD')
    expect(normalizeClaimCode('k7q2-m9xh 4twr-8zb5-n3cd')).toBe(CODE)
    expect(normalizeClaimCode('1O1L')).toBe('1011')
    expect(isClaimCode('K7Q2')).toBe(false)
    expect(isClaimCode('U'.repeat(20))).toBe(false)
  })
})

describe('the QR code', () => {
  it('carries the serial and code, and nothing else parses', () => {
    const qr = gatewayQr('EM-GW-000123', CODE)
    expect(qr).toBe('ecomanage-gw:1:EM-GW-000123:K7Q2M9XH4TWR8ZB5N3CD')
    expect(parseGatewayQr(`  ${qr}\n`)).toEqual({ serial: 'EM-GW-000123', code: CODE })
    expect(parseGatewayQr('ecomanage-gw:1:EM-GW-000123:K7Q2-M9XH-4TWR-8ZB5-N3CD')?.code).toBe(CODE)
    expect(parseGatewayQr('ecomanage-gw:2:EM-GW-000123:' + CODE)).toBeNull()
    expect(parseGatewayQr('ecomanage-gw:1:em gw:' + CODE)).toBeNull()
    expect(parseGatewayQr('ecomanage-gw:1:EM-GW-000123:SHORT')).toBeNull()
    expect(parseGatewayQr('ecomanage-gw:1:EM-GW-000123:' + CODE + ':x')).toBeNull()
    expect(parseGatewayQr('ecomanage-gw:1::' + CODE)).toBeNull()
  })

  it('or a serial typed in, upper-cased', () => {
    expect(gatewayClaimInput.parse({ serial: ' em-gw-000123 ', code: CODE })).toEqual({ serial: 'EM-GW-000123', code: CODE })
    expect(gatewayClaimInput.safeParse({ serial: 'x', code: CODE }).success).toBe(false)
    expect(gatewayClaimInput.safeParse({ qr: 'anything' }).success).toBe(true)
  })

  it('has its own topics', () => {
    expect(claimTopics.csr('EM-GW-1')).toBe('claim/EM-GW-1/csr')
    expect(claimTopics.cert('EM-GW-1')).toBe('claim/EM-GW-1/cert')
  })
})

describe('the proof', () => {
  const csr = '-----BEGIN CERTIFICATE REQUEST-----\nMIIB…\n-----END CERTIFICATE REQUEST-----\n'

  it('matches only for the same code and request', () => {
    const key = claimKey(CODE)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(claimKey('k7q2-m9xh-4twr-8zb5-n3cd')).toBe(key)
    const proof = claimProof(key, csr)
    expect(proofMatches(key, csr, proof)).toBe(true)
    expect(proofMatches(key, csr + 'x', proof)).toBe(false)
    expect(proofMatches(claimKey('0'.repeat(20)), csr, proof)).toBe(false)
    expect(proofMatches(key, csr, 'short')).toBe(false)
    expect(codeMatches(key, formatClaimCode(CODE))).toBe(true)
    expect(codeMatches(key, '0'.repeat(20))).toBe(false)
  })
})
