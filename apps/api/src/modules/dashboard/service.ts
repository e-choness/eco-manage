import mongoose from 'mongoose';
import EnergyReading from '../analytics/model';
import Device, { IDevice } from '../devices/model';
import Weather from './model';

// v1 readings are hourly kWh values. Day and month boundaries are UTC until sites carry a
// time zone (P1-03).

const round2 = (n: number): number => parseFloat(n.toFixed(2));
const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_PER_KWH = 0.12;
const CARBON_KG_PER_KWH = 0.5;

export type SystemStatus = 'optimal' | 'warning' | 'critical' | 'unknown';

export interface DashboardOverview {
  totalProduction: number; // kWh, last 30 days
  currentPower: number; // kW, production in the latest hour
  dailyProduction: number; // kWh per day, 30-day average
  monthlyProduction: number; // kWh, calendar month to date
  todayProduction: number; // kWh since midnight
  productionChangePct: number | null; // today vs yesterday up to the same time; null without a baseline
  systemStatus: SystemStatus;
  weatherCondition: string;
  temperature: number;
  savings: number; // $, last 30 days
  carbonOffsetKg: number; // kg CO2, last 30 days
}

export interface EnergyFlow {
  solar: number;
  wind: number;
  battery: number;
  consumption: number;
  grid: number; // positive = importing, negative = exporting
  timestamp: string | null;
}

const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

// Online and charging devices are working; offline and maintenance are not.
export const systemStatusOf = (devices: Pick<IDevice, 'status'>[]): SystemStatus => {
  if (devices.length === 0) return 'unknown';
  const working = devices.filter((d) => d.status === 'online' || d.status === 'charging').length / devices.length;
  if (working === 1) return 'optimal';
  return working >= 0.5 ? 'warning' : 'critical';
};

interface ProductionWindows {
  last30: number;
  month: number;
  today: number;
  yesterdaySoFar: number;
}

const productionWindows = async (userId: mongoose.Types.ObjectId, now: Date): Promise<ProductionWindows> => {
  const last30Start = new Date(now.getTime() - 30 * DAY_MS);
  const monthStart = startOfUtcMonth(now);
  const todayStart = startOfUtcDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const yesterdaySameTime = new Date(now.getTime() - DAY_MS);
  const from = new Date(Math.min(last30Start.getTime(), monthStart.getTime(), yesterdayStart.getTime()));

  const since = (start: Date) => ({ $cond: [{ $gte: ['$timestamp', start] }, '$value', 0] });
  const [row] = await EnergyReading.aggregate<ProductionWindows>([
    { $match: { userId, type: 'production', timestamp: { $gte: from, $lte: now } } },
    {
      $group: {
        _id: null,
        last30: { $sum: since(last30Start) },
        month: { $sum: since(monthStart) },
        today: { $sum: since(todayStart) },
        yesterdaySoFar: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$timestamp', yesterdayStart] }, { $lte: ['$timestamp', yesterdaySameTime] }] },
              '$value',
              0,
            ],
          },
        },
      },
    },
  ]);
  return row ?? { last30: 0, month: 0, today: 0, yesterdaySoFar: 0 };
};

// All readings at the most recent timestamp that isn't in the future: two queries, whatever
// the number of devices.
const latestReadings = async (userId: mongoose.Types.ObjectId, now: Date) => {
  const filter = { userId, timestamp: { $lte: now } };
  const latest = await EnergyReading.findOne(filter).sort({ timestamp: -1 }).select('timestamp').lean();
  if (!latest) return { timestamp: null, readings: [] };
  const readings = await EnergyReading.find({ ...filter, timestamp: latest.timestamp }).lean();
  return { timestamp: latest.timestamp, readings };
};

// Total production in the most recent hour that has production readings.
const currentProduction = async (userId: mongoose.Types.ObjectId, now: Date): Promise<number> => {
  const filter = { userId, type: 'production', timestamp: { $lte: now } };
  const latest = await EnergyReading.findOne(filter).sort({ timestamp: -1 }).select('timestamp').lean();
  if (!latest) return 0;
  const [row] = await EnergyReading.aggregate<{ kw: number }>([
    { $match: { ...filter, timestamp: latest.timestamp } },
    { $group: { _id: null, kw: { $sum: '$value' } } },
  ]);
  return row?.kw ?? 0;
};

export const overview = async (userId: string, now = new Date()): Promise<DashboardOverview> => {
  const uid = new mongoose.Types.ObjectId(userId);
  const [windows, currentPower, devices, weather] = await Promise.all([
    productionWindows(uid, now),
    currentProduction(uid, now),
    Device.find({ userId: uid }).select('status').lean(),
    Weather.findOne({ userId: uid }).lean(),
  ]);

  const { last30, month, today, yesterdaySoFar } = windows;
  return {
    totalProduction: round2(last30),
    currentPower: round2(currentPower),
    dailyProduction: round2(last30 / 30),
    monthlyProduction: round2(month),
    todayProduction: round2(today),
    productionChangePct: yesterdaySoFar > 0 ? round2(((today - yesterdaySoFar) / yesterdaySoFar) * 100) : null,
    systemStatus: systemStatusOf(devices),
    weatherCondition: weather?.condition || 'sunny',
    temperature: weather?.temperature || 22,
    savings: round2(last30 * PRICE_PER_KWH),
    carbonOffsetKg: round2(last30 * CARBON_KG_PER_KWH),
  };
};

export const energyFlow = async (userId: string, now = new Date()): Promise<EnergyFlow> => {
  const uid = new mongoose.Types.ObjectId(userId);
  const [devices, latest] = await Promise.all([
    Device.find({ userId: uid }).select('type').lean(),
    latestReadings(uid, now),
  ]);

  const typeOf = new Map(devices.map((d) => [String(d._id), d.type]));
  const produced = (type: IDevice['type']) =>
    latest.readings
      .filter((r) => r.type === 'production' && typeOf.get(String(r.deviceId)) === type)
      .reduce((sum, r) => sum + r.value, 0);

  const solar = produced('solar');
  const wind = produced('wind');
  const battery = produced('battery'); // discharge; v1 has no charge readings
  const consumption = latest.readings.filter((r) => r.type === 'consumption').reduce((sum, r) => sum + r.value, 0);

  return {
    solar: round2(solar),
    wind: round2(wind),
    battery: round2(battery),
    consumption: round2(consumption),
    grid: round2(consumption - solar - wind - battery),
    timestamp: latest.timestamp ? latest.timestamp.toISOString() : null,
  };
};
