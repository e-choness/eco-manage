import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { topics } from '@ecomanage/shared';
import type { CommandLink } from './dispatcher';

// The rules service's MQTT side (svc-rules certificate: may only write site/+/cmd/+). Acks come
// back through ingest, which records them on the command.

const PUBLISH_TIMEOUT_MS = 5000;

export const createCommandLink = (url: string, certDir: string): CommandLink & { close(): Promise<void> } => {
  const client = mqtt.connect(url, {
    ca: readFileSync(`${certDir}/ca.crt`),
    cert: readFileSync(`${certDir}/svc-rules.crt`),
    key: readFileSync(`${certDir}/svc-rules.key`),
    clientId: `svc-rules-${process.pid}`,
    reconnectPeriod: 2000,
  });
  return {
    sendCommand(siteId, commandId, command) {
      return new Promise((resolve) => {
        if (!client.connected) return resolve(false);
        const timer = setTimeout(() => resolve(false), PUBLISH_TIMEOUT_MS);
        client.publish(topics.command(siteId, commandId), JSON.stringify(command), { qos: 1 }, (err) => {
          clearTimeout(timer);
          resolve(!err);
        });
      });
    },
    async close() {
      await client.endAsync();
    },
  };
};
