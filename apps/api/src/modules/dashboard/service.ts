import EnergyReading from '../analytics/model';
import Device from '../devices/model';
import Weather from './model';

const round2 = (n: number): number => parseFloat(n.toFixed(2));
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DashboardOverview {
  totalProduction: number;
  currentPower: number;
  dailyProduction: number;
  monthlyProduction: number;
  systemStatus: number;
  weatherCondition: string;
  temperature: number;
  savings: number;
  carbonOffset: number;
}

export interface EnergyFlow {
  solar: number;
  wind: number;
  battery: number;
  grid: number;
  consumption: number;
}

export const overview = async (userId: string): Promise<DashboardOverview> => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
  const readings = await EnergyReading.find({ userId, timestamp: { $gte: thirtyDaysAgo } });

  const totalProduction = readings.filter((r) => r.type === 'production').reduce((sum, r) => sum + r.value, 0);

  const latestReading = await EnergyReading.findOne({ userId }).sort({ timestamp: -1 }).exec();
  const currentPower = latestReading?.value || 0;

  const dailyProduction = totalProduction / 30;
  const monthlyProduction = dailyProduction * 30;

  // System status (count of online devices vs total devices)
  const devices = await Device.find({ userId });
  const onlineDevices = devices.filter((d) => d.status === 'online').length;
  const systemStatus = devices.length > 0 ? ((onlineDevices / devices.length) * 100).toFixed(1) : '0';

  // Estimated savings (roughly $0.12 per kWh) and carbon offset (roughly 0.5 kg CO2 per kWh)
  const savings = (totalProduction * 0.12).toFixed(2);
  const carbonOffset = (totalProduction * 0.5).toFixed(2);

  const weather = await Weather.findOne({ userId });

  return {
    totalProduction: round2(totalProduction),
    currentPower: round2(currentPower),
    dailyProduction: round2(dailyProduction),
    monthlyProduction: round2(monthlyProduction),
    systemStatus: parseFloat(systemStatus),
    weatherCondition: weather?.condition || 'sunny',
    temperature: weather?.temperature || 22,
    savings: parseFloat(savings),
    carbonOffset: parseFloat(carbonOffset),
  };
};

export const energyFlow = async (userId: string): Promise<EnergyFlow> => {
  const devices = await Device.find({ userId });

  // Most recent reading for each device
  const deviceReadings = await Promise.all(
    devices.map(async (device) => {
      const latestReading = await EnergyReading.findOne({ userId, deviceId: device._id }).sort({ timestamp: -1 }).exec();
      return { type: device.type, value: latestReading?.value || 0 };
    })
  );

  const sumOf = (type: string) => deviceReadings.filter((r) => r.type === type).reduce((sum, r) => sum + r.value, 0);

  return {
    solar: round2(sumOf('solar')),
    wind: round2(sumOf('wind')),
    battery: round2(sumOf('battery')),
    grid: round2(sumOf('grid')),
    // Consumption is tracked separately
    consumption: round2(sumOf('battery')), // Battery tracks consumption
  };
};
