import EnergyReading from './model';
import { IDevice } from '../devices/model';
import { sendLLMRequest } from './llmService';

export interface ProductionPoint {
  date: string;
  solar: number;
  wind: number;
  total: number;
}

export interface ConsumptionPoint {
  date: string;
  consumption: number;
}

const round2 = (n: number): number => parseFloat(n.toFixed(2));
const dayOf = (ts: Date): string => new Date(ts).toISOString().split('T')[0];

export const periodDates = (period: string = 'month', now = new Date()): { startDate: Date; endDate: Date } => {
  const endDate = new Date(now);
  const startDate = new Date(now);

  switch (period.toLowerCase()) {
    case 'week':
      startDate.setDate(endDate.getDate() - 7);
      break;
    case 'year':
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(endDate.getMonth() - 1);
  }

  return { startDate, endDate };
};

export const production = async (userId: string, period: string): Promise<ProductionPoint[]> => {
  const { startDate, endDate } = periodDates(period);
  const readings = await EnergyReading.find({
    userId,
    type: 'production',
    timestamp: { $gte: startDate, $lte: endDate },
  })
    .populate<{ deviceId: IDevice | null }>('deviceId')
    .sort({ timestamp: 1 });

  const daily: Record<string, { solar: number; wind: number; total: number }> = {};
  for (const reading of readings) {
    const day = (daily[dayOf(reading.timestamp)] ??= { solar: 0, wind: 0, total: 0 });
    const deviceType = reading.deviceId?.type || 'unknown';
    if (deviceType === 'solar') day.solar += reading.value;
    else if (deviceType === 'wind') day.wind += reading.value;
    day.total += reading.value;
  }

  return Object.entries(daily).map(([date, v]) => ({
    date,
    solar: round2(v.solar),
    wind: round2(v.wind),
    total: round2(v.total),
  }));
};

export const consumption = async (userId: string, period: string): Promise<ConsumptionPoint[]> => {
  const { startDate, endDate } = periodDates(period);
  const readings = await EnergyReading.find({
    userId,
    type: 'consumption',
    timestamp: { $gte: startDate, $lte: endDate },
  }).sort({ timestamp: 1 });

  const daily: Record<string, number> = {};
  for (const reading of readings) {
    const day = dayOf(reading.timestamp);
    daily[day] = (daily[day] ?? 0) + reading.value;
  }

  return Object.entries(daily).map(([date, value]) => ({ date, consumption: round2(value) }));
};

export const insight = (data: unknown): Promise<string> => {
  const prompt = `Based on the following energy data for a renewable energy system, provide a brief insight and recommendation:

${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}

Please provide a concise insight (2-3 sentences) about the energy usage patterns and one actionable recommendation.`;

  return sendLLMRequest(prompt);
};
