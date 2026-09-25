import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DEMO_SITE_ID } from '@ecomanage/shared';

const env = z.object({
  SITE_ID: z.string().default(DEMO_SITE_ID),
  SIM_SPEED: z.coerce.number().default(1),
  SIM_SEED: z.coerce.number().int().default(42),
  SIM_START: z.string().datetime({ offset: true }).optional(),
  SIM_HTTP_PORT: z.coerce.number().int().default(4100),
  MQTT_URL: z.string().default('mqtts://mosquitto:8883'),
  MQTT_CERT_DIR: z.string().default('/repo/infra/mosquitto/certs'),
  LOG_LEVEL: z.string().default('info'),
  // Counters and battery charge survive restarts through this file (empty: no persistence).
  SIM_STATE_FILE: z.string().default(''),
});

export interface SimConfig {
  siteId: string;
  speed: number;
  seed: number;
  start: Date;
  httpPort: number;
  mqttUrl: string;
  certDir: string;
  logLevel: string;
  stateFile: string;
}

/** Flags win over environment variables: `--speed 60 --seed 42 --start 2026-09-24T04:00:00Z`. */
export const loadConfig = (argv = process.argv.slice(2), source = process.env): SimConfig => {
  const e = env.parse(source);
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const start = flag('start') ?? e.SIM_START;
  return {
    siteId: flag('site') ?? e.SITE_ID,
    speed: Number(flag('speed') ?? e.SIM_SPEED),
    seed: Number(flag('seed') ?? e.SIM_SEED),
    start: start ? new Date(start) : new Date(),
    httpPort: e.SIM_HTTP_PORT,
    mqttUrl: e.MQTT_URL,
    certDir: e.MQTT_CERT_DIR,
    logLevel: e.LOG_LEVEL,
    stateFile: e.SIM_STATE_FILE,
  };
};

export const readCerts = (certDir: string, siteId: string) => ({
  ca: readFileSync(`${certDir}/ca.crt`),
  cert: readFileSync(`${certDir}/gw-${siteId}.crt`),
  key: readFileSync(`${certDir}/gw-${siteId}.key`),
});
