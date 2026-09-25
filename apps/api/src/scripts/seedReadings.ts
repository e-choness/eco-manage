import type { Types } from 'mongoose';

export interface SeedDevices {
  solarA: Types.ObjectId;
  solarB: Types.ObjectId;
  wind: Types.ObjectId;
  // Site consumption is metered at the grid connection, not by the battery.
  gridMeter: Types.ObjectId;
}

export interface SeedReading {
  deviceId: Types.ObjectId;
  userId: Types.ObjectId;
  timestamp: Date;
  value: number;
  type: 'production' | 'consumption';
}

const HOUR_MS = 60 * 60 * 1000;

// Hourly kWh readings for the `days` days up to and including the current hour (UTC).
// Nothing is written in the future.
export const buildSeedReadings = (
  userId: Types.ObjectId,
  devices: SeedDevices,
  now: Date,
  days = 365,
  random: () => number = Math.random
): SeedReading[] => {
  const readings: SeedReading[] = [];
  const lastHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const firstHour = lastHour - (days * 24 - 1) * HOUR_MS;

  for (let t = firstHour; t <= lastHour; t += HOUR_MS) {
    const timestamp = new Date(t);
    const hour = timestamp.getUTCHours();
    const dayOfYear = Math.floor((t - Date.UTC(timestamp.getUTCFullYear(), 0, 1)) / (24 * HOUR_MS));
    const season = Math.sin(dayOfYear * ((2 * Math.PI) / 365)) * 0.8 + 0.2;

    // Solar: sine curve between 06:00 and 18:00, peaking at noon
    const solarFraction = (hour - 6) / 12;
    const solar = solarFraction > 0 && solarFraction < 1 ? Math.sin(solarFraction * Math.PI) * 5.5 : 0;
    readings.push({ deviceId: devices.solarA, userId, timestamp, value: Math.max(0, solar * season * 0.6), type: 'production' });
    readings.push({ deviceId: devices.solarB, userId, timestamp, value: Math.max(0, solar * season), type: 'production' });

    // Wind: seasonal base with random variation
    const windBase = Math.sin(dayOfYear * ((2 * Math.PI) / 365)) * 3 + 5;
    readings.push({ deviceId: devices.wind, userId, timestamp, value: Math.max(0, windBase + random() * 4), type: 'production' });

    // Site load: base load plus morning and evening peaks
    const peak = (hour >= 7 && hour <= 9) || (hour >= 18 && hour <= 21) ? 2 : 0;
    readings.push({ deviceId: devices.gridMeter, userId, timestamp, value: 2.5 + peak + random(), type: 'consumption' });
  }

  return readings;
};
