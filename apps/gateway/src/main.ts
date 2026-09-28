import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { Agent } from './agent';
import { loadConfig, loadFactory } from './config';
import { closeModbus } from './modbus/link';
import { OcppServer } from './ocpp/server';
import { Store } from './store';
import { Uplink } from './uplink';

// The gateway agent (P5-04). `GATEWAY_CONFIG=/etc/ecomanage/gateway.json node … src/main.ts`;
// on a Raspberry Pi it runs as a systemd service that restarts it (see docs/deploy/gateway.md).

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { svc: 'gateway' } });

const main = async () => {
  const cfg = loadConfig(process.env.GATEWAY_CONFIG ?? '/etc/ecomanage/gateway.json');
  const factory = loadFactory(process.env.GATEWAY_FACTORY ?? cfg.factoryFile);
  mkdirSync(cfg.dataDir, { recursive: true });
  const store = new Store(join(cfg.dataDir, 'gateway.db'));

  const ocpp = cfg.ocpp ? new OcppServer({ port: cfg.ocpp.port, password: cfg.ocpp.password }) : undefined;
  if (ocpp) {
    await ocpp.start();
    ocpp.on('connect', (id: string) => log.info({ chargePointId: id }, 'charger connected'));
    ocpp.on('disconnect', (id: string) => log.warn({ chargePointId: id }, 'charger disconnected'));
    log.info({ port: ocpp.port }, 'OCPP 1.6J server listening at /ocpp/<charge point id>');
  }

  let agent: Agent | null = null;
  const uplink = new Uplink(cfg, factory, store, log, (topic, payload) => void agent?.handle(topic, payload).catch((err: Error) => log.error({ err: err.message, topic }, 'message failed')));
  agent = new Agent({ cfg, store, link: uplink, log, ocpp });
  agent.loadDevices();
  agent.start(); // polls and keeps readings even before it is claimed
  log.info({ serial: factory.serial, buffered: store.count() }, 'gateway started');
  await uplink.start();
  await agent.publishStatus();

  const stop = async () => {
    agent?.stop();
    await uplink.close();
    await ocpp?.close();
    closeModbus();
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
};

main().catch((err: Error) => {
  log.fatal({ err: err.message }, 'gateway failed to start');
  process.exit(1);
});
