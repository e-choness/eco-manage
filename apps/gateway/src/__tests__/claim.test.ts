/**
 * P5-04: claiming, from the gateway's side. It asks over the bootstrap connection with a proof of
 * its claim code, takes only a certificate made for its own key, then connects as the site.
 */
import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as x509 from '@peculiar/x509'
import type { IClientOptions, MqttClient } from 'mqtt'
import { claimTopics, subscriptions, type ClaimCsrMessage } from '@ecomanage/shared'
import { claimKey, proofMatches } from '@ecomanage/shared/claim-proof'
import { gatewayConfig } from '../config'
import { makeRequest } from '../identity'
import { Store } from '../store'
import { Uplink } from '../uplink'

x509.cryptoProvider.set(webcrypto as unknown as Crypto)

const SERIAL = 'EM-GW-000123'
const CODE = 'K7Q2M9XH4TWR8ZB5N3CD'
const SITE = '650000000000000000000042'
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
const log = { info: () => undefined, warn: () => undefined }
const dir = mkdtempSync(join(tmpdir(), 'gw-claim-'))

// The broker, as far as the gateway can tell.
class FakeClient extends EventEmitter {
  connected = false
  published: { topic: string; payload: string }[] = []
  subscribed: string[] = []
  ended = false
  constructor(readonly opts: IClientOptions) {
    super()
  }
  up() {
    this.connected = true
    this.emit('connect')
  }
  subscribe(topic: string | string[], _o: unknown, cb?: () => void) {
    this.subscribed.push(...(Array.isArray(topic) ? topic : [topic]))
    cb?.()
  }
  publish(topic: string, payload: string, _o: unknown, cb?: (err?: Error) => void) {
    this.published.push({ topic, payload })
    cb?.()
  }
  end(_f: boolean, _o: unknown, cb: () => void) {
    this.ended = true
    cb()
  }
  async endAsync() {
    this.ended = true
  }
}
const clients: FakeClient[] = []
const connect = (_url: string, opts: IClientOptions) => {
  const c = new FakeClient(opts)
  clients.push(c)
  return c as unknown as MqttClient
}

let ca: x509.X509Certificate
let caKey: CryptoKey
/** What the cloud does once the gateway is claimed: sign its request as the site. */
const certify = async (csrPem: string, cn = SITE) =>
  (
    await x509.X509CertificateGenerator.create({
      serialNumber: '0a',
      subject: `CN=${cn}`,
      issuer: ca.subject,
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 86_400_000),
      signingAlgorithm: RSA,
      publicKey: new x509.Pkcs10CertificateRequest(csrPem).publicKey,
      signingKey: caKey,
    })
  ).toString('pem')

const cfg = gatewayConfig.parse({ mqttUrl: 'mqtts://broker:8883', bootstrap: { cert: join(dir, 'b.crt'), key: join(dir, 'b.key'), ca: join(dir, 'ca.crt') } })

beforeAll(async () => {
  const keys = await webcrypto.subtle.generateKey(RSA, true, ['sign', 'verify'])
  caKey = keys.privateKey
  ca = await x509.X509CertificateGenerator.createSelfSigned({ serialNumber: '01', name: 'CN=Test CA', notBefore: new Date(Date.now() - 86_400_000), notAfter: new Date(Date.now() + 86_400_000), keys, signingAlgorithm: RSA })
  for (const f of ['b.crt', 'b.key', 'ca.crt']) writeFileSync(join(dir, f), 'bootstrap-pem')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('claiming', () => {
  it('asks with a proof of its code, and switches to the site certificate it gets back', async () => {
    const store = new Store()
    const up = new Uplink(cfg, { serial: SERIAL, claimCode: CODE }, store, log, () => undefined, connect)
    const started = up.start()
    await new Promise((r) => setTimeout(r, 50)) // the key is made
    const boot = clients.at(-1)!
    expect(boot.opts).toMatchObject({ clientId: SERIAL })
    boot.up()
    expect(boot.subscribed).toEqual([claimTopics.cert(SERIAL)])
    const ask = JSON.parse(boot.published[0].payload) as ClaimCsrMessage
    expect(boot.published[0].topic).toBe(claimTopics.csr(SERIAL))
    expect(proofMatches(claimKey(CODE), ask.csr, ask.proof)).toBe(true)
    expect(up.siteId).toBeNull()

    // A certificate for some other key is ignored; so is a message that isn't one.
    const stranger = await makeRequest('EM-GW-999999')
    boot.emit('message', claimTopics.cert(SERIAL), Buffer.from(JSON.stringify({ siteId: SITE, cert: await certify(stranger.csrPem), ca: ca.toString('pem'), ts: new Date().toISOString() })))
    boot.emit('message', claimTopics.cert(SERIAL), Buffer.from('not json'))
    await new Promise((r) => setTimeout(r, 50))
    expect(boot.ended).toBe(false)

    const cert = await certify(ask.csr)
    boot.emit('message', claimTopics.cert(SERIAL), Buffer.from(JSON.stringify({ siteId: SITE, cert, ca: ca.toString('pem'), ts: new Date().toISOString() })))
    await started
    expect(boot.ended).toBe(true)
    expect(up.siteId).toBe(SITE)

    const site = clients.at(-1)!
    expect(site).not.toBe(boot)
    expect(site.opts).toMatchObject({ clientId: `gw-${SERIAL}`, cert, ca: ca.toString('pem') })
    expect(String(site.opts.key)).toMatch(/BEGIN PRIVATE KEY/)
    site.up()
    expect(site.subscribed).toEqual(subscriptions.gatewayInbox(SITE))
    expect(up.online()).toBe(true)

    // After a restart it goes straight to the site.
    const count = clients.length
    const again = new Uplink(cfg, { serial: SERIAL, claimCode: CODE }, store, log, () => undefined, connect)
    await again.start()
    expect(clients).toHaveLength(count + 1)
    expect(clients.at(-1)!.opts.cert).toBe(cert)
  })

  it('refuses a certificate naming another site, and keeps the same key while it waits', async () => {
    const store = new Store()
    const up = new Uplink(cfg, { serial: SERIAL, claimCode: CODE }, store, log, () => undefined, connect)
    void up.start()
    await new Promise((r) => setTimeout(r, 50))
    const boot = clients.at(-1)!
    boot.up()
    const ask = JSON.parse(boot.published[0].payload) as ClaimCsrMessage
    boot.emit('message', claimTopics.cert(SERIAL), Buffer.from(JSON.stringify({ siteId: SITE, cert: await certify(ask.csr, '650000000000000000000099'), ca: ca.toString('pem'), ts: new Date().toISOString() })))
    await new Promise((r) => setTimeout(r, 50))
    expect(up.siteId).toBeNull()
    expect(store.get<{ csrPem: string }>('pendingKey')?.csrPem).toBe(ask.csr)
  })
})
