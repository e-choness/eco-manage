import mongoose from 'mongoose';
import { buildSeedReadings } from '../../scripts/seedReadings';

const id = () => new mongoose.Types.ObjectId();
const devices = { solarA: id(), solarB: id(), wind: id(), gridMeter: id() };
const userId = id();
const now = new Date('2026-09-24T12:30:00Z');

describe('buildSeedReadings', () => {
  const readings = buildSeedReadings(userId, devices, now, 2, () => 0.5);

  it('writes nothing after the current hour', () => {
    const latest = Math.max(...readings.map((r) => r.timestamp.getTime()));
    expect(new Date(latest).toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('covers every hour of the window for each device', () => {
    expect(readings).toHaveLength(2 * 24 * 4);
    expect(readings[0].timestamp.toISOString()).toBe('2026-09-22T13:00:00.000Z');
  });

  it('meters site consumption on the grid meter, not the battery', () => {
    const consumption = readings.filter((r) => r.type === 'consumption');
    expect(consumption).toHaveLength(48);
    expect(consumption.every((r) => r.deviceId.equals(devices.gridMeter))).toBe(true);
  });

  it('only solar and wind produce', () => {
    const producers = new Set(readings.filter((r) => r.type === 'production').map((r) => String(r.deviceId)));
    expect(producers).toEqual(new Set([String(devices.solarA), String(devices.solarB), String(devices.wind)]));
  });

  it('has no solar output at night', () => {
    const night = readings.filter((r) => r.deviceId.equals(devices.solarB) && r.timestamp.getUTCHours() < 6);
    expect(night.every((r) => r.value === 0)).toBe(true);
  });
});
