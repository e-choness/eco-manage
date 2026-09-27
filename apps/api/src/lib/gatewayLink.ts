import { readFileSync } from 'node:fs';
import mqtt, { type MqttClient } from 'mqtt';
import { jobResultMessage, topics, type CommandMessage, type GatewayConfigMessage, type JobMessage, type JobResultMessage } from '@ecomanage/shared';

// The API's MQTT side (svc-api certificate): the retained gateway config, remote fixes from
// alerts (P2-08), and gateway jobs such as scan and commission (P4-04). Approved commands go
// out through the rules service. Tests pass a stand-in through createApp.

export interface GatewayLink {
  /** Publishes the site's gateway config (retained). Resolves false if the broker is unreachable. */
  sendConfig(siteId: string, config: Omit<GatewayConfigMessage, 'ts'>): Promise<boolean>;
  /** Publishes a device command (QoS 1). Resolves false if the broker is unreachable. */
  sendCommand(siteId: string, commandId: string, command: CommandMessage): Promise<boolean>;
  /**
   * Runs a job on the site's gateway (scan, commission, restart; P4-04) and waits for its result.
   * Resolves null if the broker is unreachable or the gateway doesn't answer in time.
   */
  runJob(siteId: string, jobId: string, job: JobMessage, timeoutMs: number): Promise<JobResultMessage | null>;
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

  const publish = (topic: string, payload: unknown, retain: boolean) =>
    new Promise<boolean>((resolve) => {
      if (!client.connected) return resolve(false);
      const timer = setTimeout(() => resolve(false), PUBLISH_TIMEOUT_MS);
      client.publish(topic, JSON.stringify(payload), { qos: 1, retain }, (err) => {
        clearTimeout(timer);
        resolve(!err);
      });
    });

  return {
    sendConfig(siteId, config) {
      const message: GatewayConfigMessage = { ts: new Date().toISOString(), ...config };
      return publish(topics.gatewayConfig(siteId), message, true);
    },
    sendCommand(siteId, commandId, command) {
      return publish(topics.command(siteId, commandId), command, false);
    },
    runJob(siteId, jobId, job, timeoutMs) {
      return new Promise<JobResultMessage | null>((resolve) => {
        if (!client.connected) return resolve(null);
        const resultTopic = topics.jobResult(siteId, jobId);
        let settled = false;
        const finish = (result: JobResultMessage | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          client.removeListener('message', onMessage);
          client.unsubscribe(resultTopic);
          resolve(result);
        };
        const onMessage = (topic: string, payload: Buffer) => {
          if (topic !== resultTopic) return;
          let body: unknown;
          try {
            body = JSON.parse(payload.toString());
          } catch {
            body = null;
          }
          const parsed = jobResultMessage.safeParse(body);
          finish(parsed.success ? parsed.data : { ok: false, ts: new Date().toISOString(), error: 'The gateway sent an unreadable result', data: {} });
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        client.on('message', onMessage);
        // Listen for the result before asking, so a fast gateway can't answer into the void.
        client.subscribe(resultTopic, { qos: 1 }, (err) => {
          if (err) return finish(null);
          client.publish(topics.job(siteId, jobId), JSON.stringify(job), { qos: 1 }, (e) => {
            if (e) finish(null);
          });
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
