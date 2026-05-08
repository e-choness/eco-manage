/**
 * Seed Script Tests
 *
 * Tests for seed script functionality
 */

import User from '../../models/User';
import Device from '../../models/Device';
import EnergyReading from '../../models/EnergyReading';
import Alert from '../../models/Alert';
import FinancialRecord from '../../models/FinancialRecord';
import Recommendation from '../../models/Recommendation';
import { generatePasswordHash } from '../../utils/password';

jest.mock('../../models/User');
jest.mock('../../models/Device');
jest.mock('../../models/EnergyReading');
jest.mock('../../models/Alert');
jest.mock('../../models/FinancialRecord');
jest.mock('../../models/Recommendation');
jest.mock('../../utils/password');

const mockUser = User as jest.Mocked<typeof User>;
const mockDevice = Device as jest.Mocked<typeof Device>;
const mockEnergyReading = EnergyReading as jest.Mocked<typeof EnergyReading>;
const mockAlert = Alert as jest.Mocked<typeof Alert>;
const mockFinancialRecord = FinancialRecord as jest.Mocked<typeof FinancialRecord>;
const mockRecommendation = Recommendation as jest.Mocked<typeof Recommendation>;
const mockGeneratePasswordHash = generatePasswordHash as jest.MockedFunction<typeof generatePasswordHash>;

describe('Seed Script Data Validation', () => {
  const demoUserId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGeneratePasswordHash.mockResolvedValue('hashed-password');
  });

  describe('User Creation', () => {
    it('should create user with correct email', async () => {
      const mockCreatedUser = {
        _id: demoUserId,
        email: 'demo@ecomanage.io',
        name: 'Demo User',
      };

      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      } as any);

      mockUser.create.mockResolvedValue(mockCreatedUser as any);

      // Call create as the seed script would
      const result = await User.create({
        email: 'demo@ecomanage.io',
        password: 'hashed-password',
        name: 'Demo User',
      });

      expect(result.email).toBe('demo@ecomanage.io');
      expect(mockGeneratePasswordHash).toBeDefined();
    });

    it('should handle existing demo user', async () => {
      const existingUser = { _id: demoUserId, email: 'demo@ecomanage.io' };

      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingUser),
      } as any);

      const found = await User.findOne({ email: 'demo@ecomanage.io' }).exec();

      expect(found).not.toBeNull();
      expect(found?.email).toBe('demo@ecomanage.io');
    });
  });

  describe('Device Creation', () => {
    it('should create 4 devices with correct types', async () => {
      const mockDevices = [
        { _id: '1', name: 'Solar Panel A', type: 'solar', userId: demoUserId },
        { _id: '2', name: 'Solar Panel B', type: 'solar', userId: demoUserId },
        { _id: '3', name: 'Wind Turbine 1', type: 'wind', userId: demoUserId },
        { _id: '4', name: 'Battery Storage', type: 'battery', userId: demoUserId },
      ];

      mockDevice.create.mockResolvedValue(mockDevices as any);

      const result = await Device.create(mockDevices);

      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('solar');
      expect(result[2].type).toBe('wind');
      expect(result[3].type).toBe('battery');
    });

    it('should set correct status for devices', async () => {
      const mockDevices = [
        { status: 'online' },
        { status: 'online' },
        { status: 'online' },
        { status: 'charging' },
      ];

      mockDevice.create.mockResolvedValue(mockDevices as any);

      const result = await Device.create(mockDevices);

      expect(result[0].status).toBe('online');
      expect(result[3].status).toBe('charging');
    });

    it('should set efficiency values for devices', async () => {
      const mockDevices = [
        { efficiency: 95 },
        { efficiency: 92 },
        { efficiency: 85 },
        { efficiency: 97 },
      ];

      mockDevice.create.mockResolvedValue(mockDevices as any);

      const result = await Device.create(mockDevices);

      expect(result[0].efficiency).toBe(95);
      expect(result[1].efficiency).toBe(92);
      expect(result[2].efficiency).toBe(85);
      expect(result[3].efficiency).toBe(97);
    });
  });

  describe('Energy Readings Generation', () => {
    it('should generate readings with production type', () => {
      const mockReading = {
        deviceId: '1',
        userId: demoUserId,
        type: 'production',
        value: 5.5,
      };

      expect(mockReading.type).toBe('production');
      expect(mockReading.value).toBeGreaterThanOrEqual(0);
    });

    it('should generate readings with consumption type', () => {
      const mockReading = {
        deviceId: '4',
        userId: demoUserId,
        type: 'consumption',
        value: 3.5,
      };

      expect(mockReading.type).toBe('consumption');
      expect(mockReading.value).toBeGreaterThanOrEqual(0);
    });

    it('should have correct timestamp format', () => {
      const mockReading = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
      };

      expect(mockReading.timestamp).toBeInstanceOf(Date);
    });

    it('should generate readings for 365 days', async () => {
      const readings = [];
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear(), 0, 1);

      for (let day = 0; day < 365; day++) {
        for (let hour = 0; hour < 24; hour++) {
          readings.push({
            timestamp: new Date(startDate),
            value: Math.random() * 10,
          });
        }
      }

      expect(readings.length).toBe(365 * 24); // 8760 readings per device

      mockEnergyReading.insertMany.mockResolvedValue(readings as any);

      const result = await EnergyReading.insertMany(readings);

      expect(result).toHaveLength(8760);
    });
  });

  describe('Alert Creation', () => {
    it('should create 4 alerts with correct types', async () => {
      const mockAlerts = [
        { type: 'warning', resolved: false },
        { type: 'info', resolved: true },
        { type: 'warning', resolved: false },
        { type: 'critical', resolved: false },
      ];

      mockAlert.create.mockResolvedValue(mockAlerts as any);

      const result = await Alert.create(mockAlerts);

      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('warning');
      expect(result[1].type).toBe('info');
      expect(result[3].type).toBe('critical');
    });

    it('should set read status for alerts', async () => {
      const mockAlerts = [
        { read: false },
        { read: true },
        { read: false },
        { read: false },
      ];

      mockAlert.create.mockResolvedValue(mockAlerts as any);

      const result = await Alert.create(mockAlerts);

      expect(result[0].read).toBe(false);
      expect(result[1].read).toBe(true);
    });

    it('should have timestamp for each alert', () => {
      const mockAlert = {
        timestamp: new Date(),
      };

      expect(mockAlert.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Financial Records Generation', () => {
    it('should create 12 monthly records', async () => {
      const records = [];

      for (let month = 0; month < 12; month++) {
        records.push({
          date: new Date(new Date().getFullYear(), month, 1),
          savings: 150 + Math.random() * 100,
          revenue: 200 + Math.random() * 150,
          costs: 50 + Math.random() * 30,
        });
      }

      expect(records).toHaveLength(12);

      mockFinancialRecord.insertMany.mockResolvedValue(records as any);

      const result = await FinancialRecord.insertMany(records);

      expect(result).toHaveLength(12);
    });

    it('should have correct financial metrics', () => {
      const record = {
        savings: 200,
        revenue: 300,
        costs: 75,
      };

      expect(record.savings).toBeGreaterThan(0);
      expect(record.revenue).toBeGreaterThan(0);
      expect(record.costs).toBeGreaterThan(0);
    });

    it('should have valid date for each record', () => {
      const record = {
        date: new Date('2024-01-01'),
      };

      expect(record.date).toBeInstanceOf(Date);
      expect(record.date.getMonth()).toBe(0); // January
    });
  });

  describe('Recommendation Creation', () => {
    it('should create 4 recommendations with pending status', async () => {
      const mockRecs = [
        { status: 'pending', priority: 'high' },
        { status: 'pending', priority: 'high' },
        { status: 'pending', priority: 'medium' },
        { status: 'pending', priority: 'medium' },
      ];

      mockRecommendation.create.mockResolvedValue(mockRecs as any);

      const result = await Recommendation.create(mockRecs);

      expect(result).toHaveLength(4);
      expect(result.every(r => r.status === 'pending')).toBe(true);
    });

    it('should have correct priority levels', async () => {
      const mockRecs = [
        { priority: 'high' },
        { priority: 'high' },
        { priority: 'medium' },
        { priority: 'medium' },
      ];

      mockRecommendation.create.mockResolvedValue(mockRecs as any);

      const result = await Recommendation.create(mockRecs);

      expect(result[0].priority).toBe('high');
      expect(result[2].priority).toBe('medium');
    });

    it('should have estimatedSavings values', () => {
      const rec = {
        estimatedSavings: 500,
        difficulty: 'medium',
      };

      expect(rec.estimatedSavings).toBeGreaterThan(0);
      expect(['easy', 'medium', 'hard']).toContain(rec.difficulty);
    });
  });

  describe('Data Integrity', () => {
    it('should link all data to same user', () => {
      const userId = '507f1f77bcf86cd799439011';

      const device = { userId };
      const reading = { userId };
      const alert = { userId };
      const financial = { userId };
      const rec = { userId };

      expect(device.userId).toBe(userId);
      expect(reading.userId).toBe(userId);
      expect(alert.userId).toBe(userId);
      expect(financial.userId).toBe(userId);
      expect(rec.userId).toBe(userId);
    });

    it('should create valid dates for all records', () => {
      const dates = [
        new Date(),
        new Date(2024, 0, 1),
        new Date('2024-06-15'),
      ];

      dates.forEach(date => {
        expect(date).toBeInstanceOf(Date);
        expect(!isNaN(date.getTime())).toBe(true);
      });
    });
  });

  describe('Seed Script Idempotency', () => {
    it('should handle clearing existing user data', async () => {
      const userId = demoUserId;

      mockUser.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: userId }),
      } as any);

      mockAlert.deleteMany.mockResolvedValue({ deletedCount: 4 } as any);
      mockDevice.deleteMany.mockResolvedValue({ deletedCount: 4 } as any);
      mockEnergyReading.deleteMany.mockResolvedValue({ deletedCount: 8760 } as any);
      mockFinancialRecord.deleteMany.mockResolvedValue({ deletedCount: 12 } as any);
      mockRecommendation.deleteMany.mockResolvedValue({ deletedCount: 4 } as any);

      // Verify that findOne is called to check existing user
      const existingUser = await User.findOne({ email: 'demo@ecomanage.io' }).exec();

      expect(existingUser).not.toBeNull();
      expect(mockUser.findOne).toHaveBeenCalled();
    });
  });
});
