import { WebSocket } from 'ws';
import { FakeModbus, fakeInverter, fakeMeter } from './fakeDevices';

// The dev stack's stand-in bench (compose profile `gateway`, P5-04): a SunSpec inverter on Modbus
// TCP 502, a CT meter on 1503 (a real one is on RS-485), and an OCPP 1.6J charger that connects to
// the gateway. Power follows a slow curve so the readings move.

const GATEWAY_OCPP = process.env.GATEWAY_OCPP ?? 'ws://gateway:8887/ocpp/EVC-BENCH';
const OCPP_PASSWORD = process.env.OCPP_PASSWORD;

const main = async () => {
  const inverterBox = new FakeModbus(502);
  const meterBox = new FakeModbus(1503);
  const inverter = fakeInverter(inverterBox, { maker: 'Bench', model: 'SunSpec 10k' });
  const meter = fakeMeter(meterBox);
  let pvWh = 5_000_000;
  let importKwh = 1200;
  let evKw = 7.4;
  const step = () => {
    const t = Date.now() / 60_000;
    const pvW = Math.max(0, Math.round(6000 + 3000 * Math.sin(t / 7)));
    const loadW = 9000 + 1500 * Math.sin(t / 3) + evKw * 1000;
    const gridW = loadW - pvW;
    pvWh += pvW / 720;
    if (gridW > 0) importKwh += gridW / 720_000;
    inverter.produce(pvW, Math.round(pvWh));
    meter.measure(gridW, importKwh);
  };
  step();
  setInterval(step, 5000);
  await Promise.all([inverterBox.start('0.0.0.0'), meterBox.start('0.0.0.0')]);
  console.log('fake inverter on :502, meter on :1503');

  // The charger: boots, charges, reports meter values; takes limits.
  const connectCharger = () => {
    const headers: Record<string, string> = OCPP_PASSWORD ? { Authorization: `Basic ${Buffer.from(`EVC-BENCH:${OCPP_PASSWORD}`).toString('base64')}` } : {};
    const ws = new WebSocket(GATEWAY_OCPP, 'ocpp1.6', { headers });
    let n = 0;
    let wh = 80_000;
    let timer: NodeJS.Timeout | null = null;
    const call = (action: string, payload: object) => ws.send(JSON.stringify([2, `b${++n}`, action, payload]));
    ws.on('open', () => {
      console.log('charger connected to the gateway');
      call('BootNotification', { chargePointVendor: 'Bench', chargePointModel: 'AC22' });
      call('StatusNotification', { connectorId: 1, errorCode: 'NoError', status: 'Charging' });
      call('StartTransaction', { connectorId: 1, idTag: 'BENCH', meterStart: wh, timestamp: new Date().toISOString() });
      timer = setInterval(() => {
        wh += (evKw * 1000) / 720;
        call('MeterValues', {
          connectorId: 1,
          meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: String(evKw), measurand: 'Power.Active.Import', unit: 'kW' }, { value: String(Math.round(wh)), measurand: 'Energy.Active.Import.Register', unit: 'Wh' }] }],
        });
      }, 5000);
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as [number, string, string, Record<string, unknown>];
      if (msg[0] !== 2) return;
      if (msg[2] === 'SetChargingProfile') {
        const limit = (msg[3].csChargingProfiles as { chargingSchedule: { chargingSchedulePeriod: { limit: number }[] } }).chargingSchedule.chargingSchedulePeriod[0].limit;
        evKw = Math.round(limit * 0.69 * 10) / 10;
      }
      if (msg[2] === 'ClearChargingProfile') evKw = 7.4;
      ws.send(JSON.stringify([3, msg[1], { status: 'Accepted' }]));
    });
    ws.on('close', () => {
      if (timer) clearInterval(timer);
      setTimeout(connectCharger, 5000);
    });
    ws.on('error', () => undefined);
  };
  connectCharger();
};

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
