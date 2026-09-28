import { readFileSync } from 'node:fs';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { claimCertMessage, claimTopics, subscriptions, type ClaimCsrMessage } from '@ecomanage/shared';
import { claimKey, claimProof } from '@ecomanage/shared/claim-proof';
import type { Factory, GatewayConfig } from './config';
import { certFits, makeRequest, type Identity, type PendingKey } from './identity';
import type { Logger } from './commands';
import type { Store } from './store';

// The gateway's connection to the cloud (P5-04). Not yet claimed: the shared bootstrap
// certificate, asking for its own certificate every 30 s until the installer claims it. Then the
// site certificate only, subscribed to its commands, jobs and config.

export type Connect = (url: string, opts: IClientOptions) => MqttClient;

export const FW = '0.1.0';
const ASK_EVERY_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 10_000;

export class Uplink {
  private client: MqttClient | null = null;
  private identity: Identity | null;

  constructor(
    private readonly cfg: GatewayConfig,
    private readonly factory: Factory,
    private readonly store: Store,
    private readonly log: Logger,
    private readonly onMessage: (topic: string, payload: unknown) => void,
    private readonly connect: Connect = mqtt.connect
  ) {
    this.identity = store.get<Identity>('identity');
  }

  get siteId(): string | null {
    return this.identity?.siteId ?? null;
  }

  online(): boolean {
    return !!this.identity && !!this.client?.connected;
  }

  /** Claims first if needed, then stays connected with the site certificate. */
  async start(): Promise<void> {
    if (!this.identity) this.identity = await this.claim();
    this.connectSite(this.identity);
  }

  private claim(): Promise<Identity> {
    const { serial, claimCode } = this.factory;
    const b = this.cfg.bootstrap;
    return new Promise((resolve, reject) => {
      void (async () => {
        let pending = this.store.get<PendingKey>('pendingKey');
        if (!pending) {
          pending = await makeRequest(serial);
          this.store.set('pendingKey', pending); // the same key across restarts until claimed
        }
        const key = pending;
        const client = this.connect(this.cfg.mqttUrl, { ca: readFileSync(b.ca), cert: readFileSync(b.cert), key: readFileSync(b.key), clientId: serial, reconnectPeriod: 5000 });
        const ask = () => {
          if (!client.connected) return;
          const msg: ClaimCsrMessage = { csr: key.csrPem, proof: claimProof(claimKey(claimCode), key.csrPem), fw: FW, ts: new Date().toISOString() };
          client.publish(claimTopics.csr(serial), JSON.stringify(msg), { qos: 1 });
        };
        const timer = setInterval(ask, ASK_EVERY_MS);
        client.on('connect', () => {
          this.log.info({ serial }, 'not claimed yet: waiting for the installer (bootstrap connection)');
          client.subscribe(claimTopics.cert(serial), { qos: 1 }, () => ask());
        });
        client.on('error', (err) => this.log.warn({ err: err.message }, 'bootstrap connection error'));
        client.on('message', (topic, payload) => {
          if (topic !== claimTopics.cert(serial)) return;
          void (async () => {
            let body: unknown;
            try {
              body = JSON.parse(payload.toString());
            } catch {
              return;
            }
            const msg = claimCertMessage.safeParse(body);
            if (!msg.success || !(await certFits(msg.data.cert, key.csrPem, msg.data.ca, msg.data.siteId))) {
              this.log.warn({ serial }, 'ignored a certificate that isn’t for this gateway');
              return;
            }
            const identity: Identity = { siteId: msg.data.siteId, certPem: msg.data.cert, keyPem: key.keyPem, caPem: msg.data.ca };
            this.store.set('identity', identity);
            this.log.info({ siteId: identity.siteId }, 'claimed: switching to the site certificate');
            clearInterval(timer);
            client.end(true, {}, () => resolve(identity));
          })().catch(reject);
        });
      })().catch(reject);
    });
  }

  private connectSite(id: Identity): void {
    const client = this.connect(this.cfg.mqttUrl, { ca: id.caPem, cert: id.certPem, key: id.keyPem, clientId: `gw-${this.factory.serial}`, reconnectPeriod: 5000, clean: false });
    client.on('connect', () => {
      this.log.info({ siteId: id.siteId }, 'connected to the cloud');
      client.subscribe(subscriptions.gatewayInbox(id.siteId), { qos: 1 });
    });
    client.on('error', (err) => this.log.warn({ err: err.message }, 'cloud connection error'));
    client.on('message', (topic, payload) => {
      let body: unknown;
      try {
        body = JSON.parse(payload.toString());
      } catch {
        return;
      }
      this.onMessage(topic, body);
    });
    this.client = client;
  }

  /** QoS 1; resolves false when it couldn't be delivered to the broker. */
  publish(topic: string, payload: unknown, retain = false): Promise<boolean> {
    return new Promise((resolve) => {
      const c = this.client;
      if (!c?.connected) return resolve(false);
      const timer = setTimeout(() => resolve(false), PUBLISH_TIMEOUT_MS);
      c.publish(topic, JSON.stringify(payload), { qos: 1, retain }, (err) => {
        clearTimeout(timer);
        resolve(!err);
      });
    });
  }

  async close(): Promise<void> {
    await this.client?.endAsync();
  }
}
