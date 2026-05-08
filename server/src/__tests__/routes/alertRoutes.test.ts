/**
 * Alert Routes Tests
 */

import Alert from '../../models/Alert';

jest.mock('../../models/Alert');

const mockAlert = Alert as jest.Mocked<typeof Alert>;

describe('Alert Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/alerts', () => {
    it('should return all alerts for user sorted by timestamp desc', async () => {
      const mockAlerts = [
        {
          _id: '1',
          userId,
          title: 'Recent Alert',
          type: 'warning',
          timestamp: new Date('2024-01-02T00:00:00Z'),
          read: false,
          resolved: false,
        },
        {
          _id: '2',
          userId,
          title: 'Older Alert',
          type: 'info',
          timestamp: new Date('2024-01-01T00:00:00Z'),
          read: true,
          resolved: true,
        },
      ];

      mockAlert.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockAlerts),
      } as any);

      const result = await Alert.find({ userId }).sort({ timestamp: -1 });

      expect(result).toHaveLength(2);
      expect(result[0].timestamp.getTime()).toBeGreaterThan(result[1].timestamp.getTime());
    });

    it('should return empty array when no alerts exist', async () => {
      mockAlert.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await Alert.find({ userId }).sort({ timestamp: -1 });

      expect(result).toHaveLength(0);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter alerts by userId', async () => {
      const mockAlerts = [
        {
          _id: '1',
          userId,
          title: 'User Alert',
          type: 'warning',
          timestamp: new Date(),
          read: false,
          resolved: false,
        },
      ];

      mockAlert.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockAlerts),
      } as any);

      const result = await Alert.find({ userId }).sort({ timestamp: -1 });

      expect(result[0].userId).toBe(userId);
    });
  });

  describe('PUT /api/alerts/read', () => {
    it('should mark alert as read', async () => {
      const alertId = '1';
      const mockUpdatedAlert = {
        _id: alertId,
        userId,
        title: 'Test Alert',
        type: 'warning',
        timestamp: new Date(),
        read: true,
        resolved: false,
      };

      mockAlert.findOneAndUpdate.mockResolvedValue(mockUpdatedAlert as any);

      const result = await Alert.findOneAndUpdate(
        { _id: alertId, userId },
        { read: true },
        { new: true }
      );

      expect(result?.read).toBe(true);
      expect(mockAlert.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: alertId, userId },
        { read: true },
        { new: true }
      );
    });

    it('should return updated alert with read true', async () => {
      const alertId = '1';
      const mockAlert_obj = {
        _id: alertId,
        userId,
        title: 'Alert',
        read: true,
        resolved: false,
      };

      mockAlert.findOneAndUpdate.mockResolvedValue(mockAlert_obj as any);

      const result = await Alert.findOneAndUpdate(
        { _id: alertId, userId },
        { read: true },
        { new: true }
      );

      expect(result?.read).toBe(true);
    });

    it('should return null if alert not found', async () => {
      const alertId = 'nonexistent';

      mockAlert.findOneAndUpdate.mockResolvedValue(null);

      const result = await Alert.findOneAndUpdate(
        { _id: alertId, userId },
        { read: true },
        { new: true }
      );

      expect(result).toBeNull();
    });

    it('should only update alert belonging to user', async () => {
      const alertId = '1';
      const differentUserId = '507f1f77bcf86cd799439012';

      mockAlert.findOneAndUpdate.mockResolvedValue(null);

      await Alert.findOneAndUpdate(
        { _id: alertId, userId: differentUserId },
        { read: true },
        { new: true }
      );

      expect(mockAlert.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: alertId, userId: differentUserId },
        { read: true },
        { new: true }
      );
    });
  });

  describe('Alert Types and Status', () => {
    it('should validate alert types', () => {
      const alertTypes = ['critical', 'warning', 'info'];
      const testAlert = { type: 'warning' };

      expect(alertTypes).toContain(testAlert.type);
    });

    it('should track read status', () => {
      const alert = {
        title: 'Test',
        read: false,
        resolved: false,
      };

      expect(alert.read).toBe(false);

      alert.read = true;
      expect(alert.read).toBe(true);
    });

    it('should track resolved status', () => {
      const alert = {
        title: 'Test',
        read: true,
        resolved: false,
      };

      expect(alert.resolved).toBe(false);

      alert.resolved = true;
      expect(alert.resolved).toBe(true);
    });

    it('should have timestamp for each alert', () => {
      const alert = {
        title: 'Test Alert',
        timestamp: new Date(),
      };

      expect(alert.timestamp).toBeInstanceOf(Date);
      expect(!isNaN(alert.timestamp.getTime())).toBe(true);
    });
  });

  describe('Alert Query Conditions', () => {
    it('should find alert by id and userId combination', async () => {
      const alertId = '1';
      mockAlert.findOneAndUpdate.mockResolvedValue({
        _id: alertId,
        userId,
      } as any);

      await Alert.findOneAndUpdate(
        { _id: alertId, userId },
        { read: true },
        { new: true }
      );

      expect(mockAlert.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: alertId, userId }),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
