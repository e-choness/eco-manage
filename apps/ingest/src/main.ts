import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import mqtt from 'mqtt';
import pino from 'pino';
import { z } from 'zod';
import { initModels } from '@ecomanage/db';
import { subscriptions } from '@ecomanage/shared';
import { Ingestor } from './ingestor';
import { markSilentDevices } from './stale';

const env = z
  .object({
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    MQTT_URL: z.string().default('mqtts://mosquitto:8883'),
    MQTT_CERT_DIR: z.string().default('/repo/infra/mosquitto/certs'),
    LOG_LEVEL: z.string().default('info'),
  })
  .parse(process.env);

const log = pino({ level: env.LOG_LEVEL });

const main = async () => {
  await mongoose.connect(env.DATABASE_URL);
  await initModels();
  const redis = new Redis(env.REDIS_URL);
  const ingestor = new Ingestor({ redis, logger: log });

  const client = mqtt.connect(env.MQTT_URL, {
    ca: readFileSync(`${env.MQTT_CERT_DIR}/ca.crt`),
    cert: readFileSync(`${env.MQTT_CERT_DIR}/svc-ingest.crt`),
    key: readFileSync(`${env.MQTT_CERT_DIR}/svc-ingest.key`),
    clientId: 'svc-ingest',
    clean: false, // keep the QoS 1 queue across restarts
    reconnectPeriod: 2000,
  });
  client.on('connect', () => {
    client.subscribe([...subscriptions.ingest], { qos: 1 });
    log.info('ingest connected');
  });
  client.on('error', (err) => log.error({ err: err.message }, 'mqtt error'));
  client.on('message', (topic, payload) => {
    ingestor.handle(topic, payload).catch((err: Error) => log.error({ err: err.message, topic }, 'handle failed'));
  });

  const watcher = setInterval(() => {
    markSilentDevices().catch((err: Error) => log.error({ err: err.message }, 'stale check failed'));
  }, 10_000);

  setInterval(() => log.info(ingestor.stats, 'ingest stats'), 60_000).unref();

  const shutdown = async () => {
    clearInterval(watcher);
    client.end();
    await ingestor.stop();
    await redis.quit();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

main().catch((err: Error) => {
  log.fatal({ err: err.message }, 'ingest failed to start');
  process.exit(1);
});
