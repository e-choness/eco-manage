import { readFileSync } from 'node:fs';
import mqtt, { type MqttClient } from 'mqtt';
import { topics, type GatewayConfigMessage } from '@ecomanage/shared';

// The API's MQTT side (svc-api certificate). For now it only publishes the retained gateway
// config; commands and jobs join it in Phase 3. Tests pass a stand-in through createApp.

export interface GatewayLink {
  /** Publishes the site's gateway config (retained). Resolves false if the broker is unreachable. */
  sendConfig(siteId: string, config: Omit<GatewayConfigMessage, 'ts'>): Promise<boolean>;
  /** Runs on every (re)connect, so config that couldn't be sent is sent then. */
  onConnect(listener: () => void): void;
  close(): Promise<void>;
}

const PUBLISH_TIMEOUT_MS = 5000;

export const createGatewayLink = (url: string, certDir: string): GatewayLink => {
  const client: MqttClient = mqtt.connect(url, {
    ca: readFileSync(`${certDir}/ca.crt`),
    cert: readFileSync(`${certDir}/svc-api.crt`),
    key: readFileSync(`${certDir}/svc-api.key`),
    clientId: `svc-api-${process.pid}`,
    reconnectPeriod: 2000,
  });

  return {
    sendConfig(siteId, config) {
      const message: GatewayConfigMessage = { ts: new Date().toISOString(), ...config };
      return new Promise((resolve) => {
        if (!client.connected) return resolve(false);
        const timer = setTimeout(() => resolve(false), PUBLISH_TIMEOUT_MS);
        client.publish(topics.gatewayConfig(siteId), JSON.stringify(message), { qos: 1, retain: true }, (err) => {
          clearTimeout(timer);
          resolve(!err);
        });
      });
    },
    onConnect(listener) {
      client.on('connect', listener);
    },
    async close() {
      await client.endAsync();
    },
  };
};
