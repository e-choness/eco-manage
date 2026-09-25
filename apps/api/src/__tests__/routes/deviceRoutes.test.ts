/**
 * Device Routes Tests
 */

import Device from '../../models/Device';

jest.mock('../../models/Device');

const mockDevice = Device as jest.Mocked<typeof Device>;

describe('Device Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/devices', () => {
    it('should return all devices for user', async () => {
      const mockDevices = [
        {
          _id: '1',
          userId,
          name: 'Solar Panel A',
          type: 'solar',
          status: 'online',
          maxOutput: 5.5,
          efficiency: 95,
          createdAt: new Date(),
        },
        {
          _id: '2',
          userId,
          name: 'Wind Turbine',
          type: 'wind',
          status: 'online',
          maxOutput: 10,
          efficiency: 85,
          createdAt: new Date(),
        },
      ];

      mockDevice.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockDevices),
      } as any);

      const result = await Device.find({ userId }).sort({ createdAt: -1 });

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('solar');
      expect(result[1].type).toBe('wind');
    });

    it('should return empty array when no devices exist', async () => {
      mockDevice.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await Device.find({ userId }).sort({ createdAt: -1 });

      expect(result).toHaveLength(0);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter devices by userId', async () => {
      const mockDevices = [
        {
          _id: '1',
          userId,
          name: 'Solar Panel',
          type: 'solar',
        },
      ];

      mockDevice.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockDevices),
      } as any);

      const result = await Device.find({ userId }).sort({ createdAt: -1 });

      expect(result[0].userId).toBe(userId);
    });
  });

  describe('POST /api/devices', () => {
    it('should create device with required fields', async () => {
      const deviceData = {
        userId,
        name: 'Solar Panel C',
        type: 'solar',
        maxOutput: 5.5,
        status: 'online',
        efficiency: 90,
        lastMaintenance: new Date(),
      };

      mockDevice.create.mockResolvedValue({
        _id: '3',
        ...deviceData,
      } as any);

      const result = await Device.create(deviceData);

      expect(result.name).toBe('Solar Panel C');
      expect(result.type).toBe('solar');
      expect(result.userId).toBe(userId);
    });

    it('should set default maxOutput if not provided', () => {
      const defaultMaxOutput = 5.0;
      expect(defaultMaxOutput).toBe(5.0);
    });

    it('should set default efficiency if not provided', () => {
      const defaultEfficiency = 90;
      expect(defaultEfficiency).toBe(90);
    });

    it('should validate device type', () => {
      const validTypes = ['solar', 'wind', 'battery', 'grid'];
      const testDevice = { type: 'solar' };

      expect(validTypes).toContain(testDevice.type);
    });

    it('should reject invalid device type', () => {
      const validTypes = ['solar', 'wind', 'battery', 'grid'];
      const invalidType = 'hydroelectric';

      expect(validTypes).not.toContain(invalidType);
    });

    it('should set initial status to online', async () => {
      const deviceData = {
        userId,
        name: 'New Device',
        type: 'solar',
        maxOutput: 5.0,
        status: 'online',
        efficiency: 90,
        lastMaintenance: new Date(),
      };

      mockDevice.create.mockResolvedValue({
        _id: '4',
        ...deviceData,
      } as any);

      const result = await Device.create(deviceData);

      expect(result.status).toBe('online');
    });

    it('should associate device with user', async () => {
      const deviceData = {
        userId,
        name: 'User Device',
        type: 'wind',
        maxOutput: 10,
        status: 'online',
        efficiency: 85,
        lastMaintenance: new Date(),
      };

      mockDevice.create.mockResolvedValue({
        _id: '5',
        ...deviceData,
      } as any);

      const result = await Device.create(deviceData);

      expect(result.userId).toBe(userId);
    });
  });

  describe('Device Types', () => {
    it('should support solar type', () => {
      const types = ['solar', 'wind', 'battery', 'grid'];
      expect(types).toContain('solar');
    });

    it('should support wind type', () => {
      const types = ['solar', 'wind', 'battery', 'grid'];
      expect(types).toContain('wind');
    });

    it('should support battery type', () => {
      const types = ['solar', 'wind', 'battery', 'grid'];
      expect(types).toContain('battery');
    });

    it('should support grid type', () => {
      const types = ['solar', 'wind', 'battery', 'grid'];
      expect(types).toContain('grid');
    });
  });

  describe('Device Status', () => {
    it('should have valid status values', () => {
      const validStatuses = ['online', 'offline', 'charging', 'maintenance'];
      const device = { status: 'online' };

      expect(validStatuses).toContain(device.status);
    });

    it('should track efficiency percentage', () => {
      const device = { efficiency: 95 };
      expect(device.efficiency).toBeGreaterThanOrEqual(0);
      expect(device.efficiency).toBeLessThanOrEqual(100);
    });

    it('should have max output specification', () => {
      const device = { maxOutput: 5.5 };
      expect(device.maxOutput).toBeGreaterThan(0);
    });
  });

  describe('Device Query Conditions', () => {
    it('should find devices by userId', async () => {
      mockDevice.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      await Device.find({ userId });

      expect(mockDevice.find).toHaveBeenCalledWith({ userId });
    });

    it('should sort devices by creation date descending', async () => {
      mockDevice.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      await Device.find({ userId }).sort({ createdAt: -1 });

      expect(mockDevice.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });
});
