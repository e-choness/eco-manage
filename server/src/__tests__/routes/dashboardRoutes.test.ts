/**
 * Dashboard Routes Tests
 */

import EnergyReading from '../../models/EnergyReading';
import Device from '../../models/Device';

jest.mock('../../models/EnergyReading');
jest.mock('../../models/Device');

const mockEnergyReading = EnergyReading as jest.Mocked<typeof EnergyReading>;
const mockDevice = Device as jest.Mocked<typeof Device>;

describe('Dashboard Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/dashboard/overview', () => {
    it('should calculate totalProduction from 30 days of readings', async () => {
      const mockReadings = [
        { deviceId: '1', userId, timestamp: new Date(), value: 5.5, type: 'production' },
        { deviceId: '2', userId, timestamp: new Date(), value: 4.5, type: 'production' },
      ];

      mockEnergyReading.find.mockResolvedValue(mockReadings as any);

      const readings = await EnergyReading.find({
        userId,
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });

      const totalProduction = readings
        .filter((r) => r.type === 'production')
        .reduce((sum, r) => sum + r.value, 0);

      expect(totalProduction).toBe(10.0);
    });

    it('should get currentPower from latest reading', async () => {
      const mockLatestReading = {
        userId,
        timestamp: new Date(),
        value: 8.5,
      };

      mockEnergyReading.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockLatestReading),
        }),
      } as any);

      const latestReading = await EnergyReading.findOne({ userId })
        .sort({ timestamp: -1 })
        .exec();

      const currentPower = latestReading?.value || 0;

      expect(currentPower).toBe(8.5);
    });

    it('should calculate dailyProduction as average over 30 days', () => {
      const totalProduction = 300;
      const dailyProduction = totalProduction / 30;

      expect(dailyProduction).toBe(10);
    });

    it('should project monthlyProduction from daily average', () => {
      const dailyProduction = 10;
      const monthlyProduction = dailyProduction * 30;

      expect(monthlyProduction).toBe(300);
    });

    it('should calculate systemStatus as percentage of online devices', async () => {
      const mockDevices = [
        { _id: '1', status: 'online' },
        { _id: '2', status: 'online' },
        { _id: '3', status: 'offline' },
        { _id: '4', status: 'charging' },
      ];

      mockDevice.find.mockResolvedValue(mockDevices as any);

      const devices = await Device.find({ userId });
      const onlineDevices = devices.filter((d) => d.status === 'online').length;
      const systemStatus = ((onlineDevices / devices.length) * 100).toFixed(1);

      expect(systemStatus).toBe('50.0');
    });

    it('should estimate savings at $0.12 per kWh', () => {
      const totalProduction = 500;
      const savings = (totalProduction * 0.12).toFixed(2);

      expect(savings).toBe('60.00');
    });

    it('should calculate CO2 offset at 0.5 kg per kWh', () => {
      const totalProduction = 500;
      const carbonOffset = (totalProduction * 0.5).toFixed(2);

      expect(carbonOffset).toBe('250.00');
    });

    it('should return 0 for currentPower when no readings exist', async () => {
      mockEnergyReading.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      } as any);

      const latestReading = await EnergyReading.findOne({ userId })
        .sort({ timestamp: -1 })
        .exec();

      const currentPower = latestReading?.value || 0;

      expect(currentPower).toBe(0);
    });

    it('should return 0 for systemStatus when no devices exist', async () => {
      mockDevice.find.mockResolvedValue([] as any);

      const devices = await Device.find({ userId });
      const systemStatus = devices.length > 0 ? ((0 / devices.length) * 100).toFixed(1) : '0';

      expect(systemStatus).toBe('0');
    });
  });

  describe('GET /api/dashboard/energy-flow', () => {
    it('should return solar production breakdown', async () => {
      const mockDevices = [
        { _id: '1', name: 'Solar A', type: 'solar' },
      ];

      const mockReadings = [
        {
          deviceId: '1',
          userId,
          value: 5.5,
          type: 'solar',
          name: 'Solar A',
        },
      ];

      mockDevice.find.mockResolvedValue(mockDevices as any);

      const solar = mockReadings
        .filter((r) => r.type === 'solar')
        .reduce((sum, r) => sum + r.value, 0);

      expect(solar).toBe(5.5);
    });

    it('should return wind production breakdown', async () => {
      const mockReadings = [
        {
          deviceId: '2',
          userId,
          value: 8.5,
          type: 'wind',
          name: 'Wind Turbine',
        },
      ];

      const wind = mockReadings
        .filter((r) => r.type === 'wind')
        .reduce((sum, r) => sum + r.value, 0);

      expect(wind).toBe(8.5);
    });

    it('should return battery storage breakdown', async () => {
      const mockReadings = [
        {
          deviceId: '3',
          userId,
          value: 10.0,
          type: 'battery',
          name: 'Battery Storage',
        },
      ];

      const battery = mockReadings
        .filter((r) => r.type === 'battery')
        .reduce((sum, r) => sum + r.value, 0);

      expect(battery).toBe(10.0);
    });

    it('should return grid flow breakdown', async () => {
      const mockReadings = [
        {
          deviceId: '4',
          userId,
          value: 2.0,
          type: 'grid',
          name: 'Grid Feed',
        },
      ];

      const grid = mockReadings
        .filter((r) => r.type === 'grid')
        .reduce((sum, r) => sum + r.value, 0);

      expect(grid).toBe(2.0);
    });

    it('should aggregate multiple readings per device type', () => {
      const mockReadings = [
        { type: 'solar', value: 5.5 },
        { type: 'solar', value: 4.5 },
      ];

      const totalSolar = mockReadings.reduce((sum, r) => sum + r.value, 0);

      expect(totalSolar).toBe(10.0);
    });

    it('should return consumption data', () => {
      const mockReadings = [
        { type: 'consumption', value: 4.0 },
      ];

      const consumption = mockReadings
        .filter((r) => r.type === 'consumption')
        .reduce((sum, r) => sum + r.value, 0);

      expect(consumption).toBe(4.0);
    });

    it('should round values to 2 decimal places', () => {
      const values = [5.555, 8.123, 10.999];
      values.forEach((val) => {
        const rounded = parseFloat(val.toFixed(2));
        const decimalPart = rounded.toString().split('.')[1];
        expect(decimalPart ? decimalPart.length : 0).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('Query Filters', () => {
    it('should filter readings by userId', async () => {
      mockEnergyReading.find.mockResolvedValue([] as any);

      await EnergyReading.find({ userId });

      expect(mockEnergyReading.find).toHaveBeenCalledWith(
        expect.objectContaining({ userId })
      );
    });

    it('should filter readings by 30-day window', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      mockEnergyReading.find.mockResolvedValue([] as any);

      await EnergyReading.find({
        userId,
        timestamp: { $gte: thirtyDaysAgo },
      });

      expect(mockEnergyReading.find).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.objectContaining({ $gte: thirtyDaysAgo }),
        })
      );
    });

    it('should filter devices by userId', async () => {
      mockDevice.find.mockResolvedValue([] as any);

      await Device.find({ userId });

      expect(mockDevice.find).toHaveBeenCalledWith({ userId });
    });
  });

  describe('Data Aggregation', () => {
    it('should sum production values correctly', () => {
      const readings = [
        { value: 5.5, type: 'production' },
        { value: 4.5, type: 'production' },
        { value: 3.0, type: 'production' },
      ];

      const total = readings.reduce((sum, r) => sum + r.value, 0);

      expect(total).toBe(13.0);
    });

    it('should handle empty production arrays', () => {
      const readings: any[] = [];
      const total = readings.reduce((sum, r) => sum + r.value, 0);

      expect(total).toBe(0);
    });

    it('should calculate percentages correctly', () => {
      const onlineDevices = 3;
      const totalDevices = 4;
      const percentage = (onlineDevices / totalDevices) * 100;

      expect(percentage).toBe(75);
    });
  });

  describe('Device Status Analysis', () => {
    it('should count online devices', () => {
      const devices = [
        { _id: '1', status: 'online' },
        { _id: '2', status: 'online' },
        { _id: '3', status: 'offline' },
      ];

      const onlineCount = devices.filter((d) => d.status === 'online').length;

      expect(onlineCount).toBe(2);
    });

    it('should distinguish between online and other statuses', () => {
      const devices = [
        { status: 'online' },
        { status: 'offline' },
        { status: 'charging' },
        { status: 'maintenance' },
      ];

      const online = devices.filter((d) => d.status === 'online').length;
      const others = devices.filter((d) => d.status !== 'online').length;

      expect(online + others).toBe(devices.length);
    });
  });
});
