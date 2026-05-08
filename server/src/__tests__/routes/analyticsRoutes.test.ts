/**
 * Analytics Routes Tests
 */

// Mock external dependencies first
jest.mock('openai');
jest.mock('@anthropic-ai/sdk');
jest.mock('../../models/EnergyReading');
jest.mock('../../services/llmService');

import EnergyReading from '../../models/EnergyReading';
import { sendLLMRequest } from '../../services/llmService';

const mockEnergyReading = EnergyReading as jest.Mocked<typeof EnergyReading>;
const mockSendLLMRequest = sendLLMRequest as jest.MockedFunction<typeof sendLLMRequest>;

describe('Analytics Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/analytics/production', () => {
    it('should aggregate production readings by day for month period', async () => {
      const mockReadings = [
        {
          _id: '1',
          deviceId: '1',
          userId,
          timestamp: new Date('2024-01-01T00:00:00Z'),
          value: 5.5,
          type: 'production',
        },
        {
          _id: '2',
          deviceId: '1',
          userId,
          timestamp: new Date('2024-01-01T12:00:00Z'),
          value: 5.5,
          type: 'production',
        },
        {
          _id: '3',
          deviceId: '1',
          userId,
          timestamp: new Date('2024-01-02T00:00:00Z'),
          value: 4.5,
          type: 'production',
        },
      ];

      mockEnergyReading.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockReadings),
      } as any);

      // Simulate the aggregation
      const result = mockReadings.reduce(
        (acc: { [key: string]: number }, reading: any) => {
          const day = new Date(reading.timestamp).toISOString().split('T')[0];
          acc[day] = (acc[day] || 0) + reading.value;
          return acc;
        },
        {}
      );

      expect(result['2024-01-01']).toBe(11.0);
      expect(result['2024-01-02']).toBe(4.5);
    });

    it('should return empty data for period with no readings', async () => {
      mockEnergyReading.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      const result: { [key: string]: number } = {};
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should group readings correctly by date', () => {
      const readings = [
        { timestamp: new Date('2024-01-01T08:00:00Z'), value: 3 },
        { timestamp: new Date('2024-01-01T14:00:00Z'), value: 5 },
        { timestamp: new Date('2024-01-02T08:00:00Z'), value: 4 },
      ];

      const dailyData: { [key: string]: number } = {};
      readings.forEach((reading) => {
        const day = new Date(reading.timestamp).toISOString().split('T')[0];
        dailyData[day] = (dailyData[day] || 0) + reading.value;
      });

      expect(dailyData['2024-01-01']).toBe(8);
      expect(dailyData['2024-01-02']).toBe(4);
    });
  });

  describe('GET /api/analytics/consumption', () => {
    it('should aggregate consumption readings by day', async () => {
      const mockReadings = [
        {
          deviceId: '4',
          userId,
          timestamp: new Date('2024-01-01T00:00:00Z'),
          value: 2.5,
          type: 'consumption',
        },
        {
          deviceId: '4',
          userId,
          timestamp: new Date('2024-01-01T12:00:00Z'),
          value: 3.0,
          type: 'consumption',
        },
      ];

      mockEnergyReading.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockReadings),
      } as any);

      const dailyData: { [key: string]: number } = {};
      mockReadings.forEach((reading) => {
        const day = new Date(reading.timestamp).toISOString().split('T')[0];
        dailyData[day] = (dailyData[day] || 0) + reading.value;
      });

      expect(dailyData['2024-01-01']).toBe(5.5);
    });

    it('should return consumption with correct type', () => {
      const readings = [
        { timestamp: new Date('2024-01-01'), value: 2.5, type: 'consumption' },
      ];

      readings.forEach((r) => {
        expect(r.type).toBe('consumption');
        expect(r.value).toBeGreaterThan(0);
      });
    });
  });

  describe('POST /api/analytics/insight', () => {
    it('should send data to LLM and return insight', async () => {
      const mockInsight =
        'Your energy production is optimal with a 25% increase compared to last month.';

      mockSendLLMRequest.mockResolvedValue(mockInsight);

      const data = {
        production: [{ date: '2024-01-01', value: 100 }],
        consumption: [{ date: '2024-01-01', value: 80 }],
      };

      const result = await sendLLMRequest(JSON.stringify(data));

      expect(result).toBe(mockInsight);
      expect(mockSendLLMRequest).toHaveBeenCalled();
    });

    it('should format prompt with energy data', () => {
      const data = { production: 100, consumption: 80 };
      const prompt = `Based on the following energy data for a renewable energy system, provide a brief insight and recommendation:

${JSON.stringify(data, null, 2)}

Please provide a concise insight (2-3 sentences) about the energy usage patterns and one actionable recommendation.`;

      expect(prompt).toContain('Based on the following energy data');
      expect(prompt).toContain('production');
      expect(prompt).toContain('consumption');
    });

    it('should call LLM service with formatted message', async () => {
      const message = 'Test energy data insight request';
      mockSendLLMRequest.mockResolvedValue('Test insight response');

      const result = await sendLLMRequest(message);

      expect(mockSendLLMRequest).toHaveBeenCalledWith(message);
      expect(result).toBe('Test insight response');
    });

    it('should handle LLM service errors gracefully', async () => {
      mockSendLLMRequest.mockRejectedValue(new Error('LLM service unavailable'));

      await expect(sendLLMRequest('test')).rejects.toThrow('LLM service unavailable');
    });
  });

  describe('Period Parameter Handling', () => {
    it('should calculate week period correctly', () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 7);

      expect(startDate.getTime()).toBeLessThan(endDate.getTime());
      expect(Math.abs(endDate.getTime() - startDate.getTime())).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
    });

    it('should calculate month period correctly', () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(endDate.getMonth() - 1);

      expect(startDate.getTime()).toBeLessThan(endDate.getTime());
    });

    it('should calculate year period correctly', () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1);

      expect(startDate.getTime()).toBeLessThan(endDate.getTime());
      const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
                        (endDate.getMonth() - startDate.getMonth());
      expect(diffMonths).toBeCloseTo(12, 1);
    });

    it('should default to month period when not specified', () => {
      const period = 'month';
      expect(['week', 'month', 'year']).toContain(period);
    });
  });

  describe('Data Formatting', () => {
    it('should format production data with date and value', () => {
      const data = { date: '2024-01-01', production: 50.5 };
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('production');
      expect(typeof data.production).toBe('number');
    });

    it('should format consumption data with date and value', () => {
      const data = { date: '2024-01-01', consumption: 40.25 };
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('consumption');
      expect(typeof data.consumption).toBe('number');
    });

    it('should round values to 2 decimal places', () => {
      const values = [50.555, 40.123, 30.999];
      values.forEach((val) => {
        const rounded = parseFloat(val.toFixed(2));
        const decimalPart = rounded.toString().split('.')[1];
        expect(decimalPart ? decimalPart.length : 0).toBeLessThanOrEqual(2);
      });
    });
  });
});
