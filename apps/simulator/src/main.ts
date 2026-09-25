import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import mqtt from 'mqtt';
import pino from 'pino';
import { DEMO_DEVICES, DEMO_SITE, subscriptions } from '@ecomanage/shared';
import { SimClock } from './clock';
import { loadConfig, readCerts } from './config';
import { createControlServer } from './control';
import { SiteEngine, type SimState } from './engine/site';
import { Gateway } from './gateway';

const STEP_S = 5; // physics step in simulated seconds
const TICK_MS = 1000; // real time between catch-up steps
const STATUS_EVERY_MS = 30_000;

const config = loadConfig();
const log = pino({ level: config.logLevel });

const engine = new SiteEngine({ tz: DEMO_SITE.tz, lat: DEMO_SITE.lat, lon: DEMO_SITE.lon, seed: config.seed, devices: DEMO_DEVICES }, config.start);
const clock = new SimClock(config.start, config.speed);

// Resume counters and battery charge from the last run, like real devices would.
if (config.stateFile && existsSync(config.stateFile)) {
  try {
    const restored = engine.restoreState(JSON.parse(readFileSync(config.stateFile, 'utf8')) as SimState);
    log.info({ restored, file: config.stateFile }, 'simulator state');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'could not read simulator state; starting fresh');
  }
}
const saveState = () => {
  if (!config.stateFile) return;
  const tmp = `${config.stateFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(engine.saveState()));
  renameSync(tmp, config.stateFile);
};

const client = mqtt.connect(config.mqttUrl, {
  ...readCerts(config.certDir, config.siteId),
  clientId: `gw-${config.siteId}`,
  reconnectPeriod: 2000,
  rejectUnauthorized: true,
});

// At higher speeds each device publishes once per real second (every `speed` simulated seconds),
// so a 60× run sends about 10 messages per second instead of 120.
const publishEveryMs = () => Math.max(5000, clock.speed * 1000);

const gateway = new Gateway(engine, config.siteId, (topic, payload, options) => {
  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: options?.retain ?? false });
}, publishEveryMs);

client.on('connect', () => {
  log.info({ site: config.siteId, speed: clock.speed, seed: config.seed }, 'gateway connected');
  client.subscribe(subscriptions.gatewayInbox(config.siteId), { qos: 1 });
  gateway.publishGatewayStatus();
});
client.on('error', (err) => log.error({ err: err.message }, 'mqtt error'));
client.on('message', (topic, buf) => {
  try {
    gateway.handleMessage(topic, JSON.parse(buf.toString()));
  } catch {
    log.warn({ topic }, 'ignored a message that is not JSON');
  }
});

let lastStatus = 0;
setInterval(() => {
  try {
    saveState();
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'could not save simulator state');
  }
}, 30_000);
setInterval(() => {
  const target = clock.now().getTime();
  while (engine.now.getTime() + STEP_S * 1000 <= target) {
    engine.step(STEP_S);
    gateway.tick();
  }
  if (Date.now() - lastStatus >= STATUS_EVERY_MS) {
    lastStatus = Date.now();
    gateway.publishGatewayStatus();
  }
}, TICK_MS);

createControlServer(engine, gateway, clock).listen(config.httpPort, () => log.info({ port: config.httpPort }, 'control API listening'));

const stop = () => {
  try {
    saveState();
  } catch {
    // best effort
  }
  client.end(false, {}, () => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
