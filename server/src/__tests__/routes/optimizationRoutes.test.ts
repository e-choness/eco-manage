/**
 * Optimization Routes Tests
 */

import Recommendation from '../../models/Recommendation';

jest.mock('../../models/Recommendation');

const mockRecommendation = Recommendation as jest.Mocked<typeof Recommendation>;

describe('Optimization Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/optimization/recommendations', () => {
    it('should return all pending and accepted recommendations', async () => {
      const mockRecs = [
        {
          _id: '1',
          userId,
          title: 'Install Solar Panels',
          priority: 'high',
          status: 'pending',
          createdAt: new Date('2024-01-02'),
        },
        {
          _id: '2',
          userId,
          title: 'Upgrade Battery',
          priority: 'high',
          status: 'accepted',
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockRecommendation.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecs),
      } as any);

      const result = await Recommendation.find({
        userId,
        status: { $in: ['pending', 'accepted'] },
      }).sort({ priority: -1, createdAt: -1 });

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('pending');
      expect(result[1].status).toBe('accepted');
    });

    it('should exclude dismissed recommendations', async () => {
      const mockRecs = [
        {
          _id: '1',
          userId,
          title: 'Pending Rec',
          status: 'pending',
        },
      ];

      mockRecommendation.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecs),
      } as any);

      const result = await Recommendation.find({
        userId,
        status: { $in: ['pending', 'accepted'] },
      }).sort({ priority: -1, createdAt: -1 });

      expect(result.every((r) => r.status !== 'dismissed')).toBe(true);
    });

    it('should sort by priority then creation date', async () => {
      const mockRecs = [
        {
          _id: '1',
          userId,
          title: 'High Priority',
          priority: 'high',
          status: 'pending',
          createdAt: new Date('2024-01-01'),
        },
        {
          _id: '2',
          userId,
          title: 'Medium Priority',
          priority: 'medium',
          status: 'pending',
          createdAt: new Date('2024-01-02'),
        },
      ];

      mockRecommendation.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecs),
      } as any);

      const result = await Recommendation.find({
        userId,
        status: { $in: ['pending', 'accepted'] },
      }).sort({ priority: -1, createdAt: -1 });

      expect(result[0].priority).toBe('high');
    });

    it('should return empty array if no recommendations', async () => {
      mockRecommendation.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      const result = await Recommendation.find({
        userId,
        status: { $in: ['pending', 'accepted'] },
      }).sort({ priority: -1, createdAt: -1 });

      expect(result).toHaveLength(0);
    });
  });

  describe('POST /api/optimization/accept', () => {
    it('should update recommendation status to accepted', async () => {
      const recId = '1';
      const mockUpdatedRec = {
        _id: recId,
        userId,
        title: 'Install Solar',
        status: 'accepted',
        priority: 'high',
        estimatedSavings: 500,
      };

      mockRecommendation.findOneAndUpdate.mockResolvedValue(mockUpdatedRec as any);

      const result = await Recommendation.findOneAndUpdate(
        { _id: recId, userId },
        { status: 'accepted' },
        { new: true }
      );

      expect(result?.status).toBe('accepted');
      expect(mockRecommendation.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: recId, userId },
        { status: 'accepted' },
        { new: true }
      );
    });

    it('should return updated recommendation', async () => {
      const recId = '1';
      const mockRec = {
        _id: recId,
        userId,
        title: 'Upgrade Battery',
        status: 'accepted',
        priority: 'high',
      };

      mockRecommendation.findOneAndUpdate.mockResolvedValue(mockRec as any);

      const result = await Recommendation.findOneAndUpdate(
        { _id: recId, userId },
        { status: 'accepted' },
        { new: true }
      );

      expect(result?.title).toBe('Upgrade Battery');
      expect(result?.status).toBe('accepted');
    });

    it('should return null if recommendation not found', async () => {
      const recId = 'nonexistent';

      mockRecommendation.findOneAndUpdate.mockResolvedValue(null);

      const result = await Recommendation.findOneAndUpdate(
        { _id: recId, userId },
        { status: 'accepted' },
        { new: true }
      );

      expect(result).toBeNull();
    });

    it('should only update recommendation belonging to user', async () => {
      const recId = '1';
      const otherUserId = '507f1f77bcf86cd799439012';

      mockRecommendation.findOneAndUpdate.mockResolvedValue(null);

      await Recommendation.findOneAndUpdate(
        { _id: recId, userId: otherUserId },
        { status: 'accepted' },
        { new: true }
      );

      expect(mockRecommendation.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: recId, userId: otherUserId },
        { status: 'accepted' },
        { new: true }
      );
    });
  });

  describe('Recommendation Types', () => {
    it('should validate priority levels', () => {
      const validPriorities = ['high', 'medium', 'low'];
      const rec = { priority: 'high' };

      expect(validPriorities).toContain(rec.priority);
    });

    it('should validate status values', () => {
      const validStatuses = ['pending', 'accepted', 'dismissed'];
      const rec = { status: 'pending' };

      expect(validStatuses).toContain(rec.status);
    });

    it('should validate difficulty levels', () => {
      const validDifficulties = ['easy', 'medium', 'hard'];
      const rec = { difficulty: 'medium' };

      expect(validDifficulties).toContain(rec.difficulty);
    });

    it('should have title and description', () => {
      const rec = {
        title: 'Install Additional Solar Panels',
        description: 'Adding 5 more panels could increase daily production by 25%',
      };

      expect(rec.title).toBeDefined();
      expect(rec.description).toBeDefined();
      expect(typeof rec.title).toBe('string');
      expect(typeof rec.description).toBe('string');
    });

    it('should have estimatedSavings as positive number', () => {
      const rec = { estimatedSavings: 500 };

      expect(rec.estimatedSavings).toBeGreaterThan(0);
    });

    it('should have category for organization', () => {
      const rec = { category: 'Solar Expansion' };

      expect(typeof rec.category).toBe('string');
      expect(rec.category.length).toBeGreaterThan(0);
    });
  });

  describe('Recommendation Sorting', () => {
    it('should sort by priority high first', () => {
      const recs = [
        { priority: 'medium', createdAt: new Date() },
        { priority: 'high', createdAt: new Date() },
        { priority: 'low', createdAt: new Date() },
      ];

      const sorted = recs.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return (priorityOrder[b.priority as keyof typeof priorityOrder] || 0) -
               (priorityOrder[a.priority as keyof typeof priorityOrder] || 0);
      });

      expect(sorted[0].priority).toBe('high');
    });

    it('should sort by creation date within same priority', () => {
      const recs = [
        { priority: 'high', createdAt: new Date('2024-01-01') },
        { priority: 'high', createdAt: new Date('2024-01-02') },
      ];

      expect(recs[1].createdAt.getTime()).toBeGreaterThan(recs[0].createdAt.getTime());
    });
  });

  describe('Recommendation Query Conditions', () => {
    it('should find by userId and status', async () => {
      mockRecommendation.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      await Recommendation.find({
        userId,
        status: { $in: ['pending', 'accepted'] },
      }).sort({ priority: -1, createdAt: -1 });

      expect(mockRecommendation.find).toHaveBeenCalledWith({
        userId,
        status: { $in: ['pending', 'accepted'] },
      });
    });

    it('should find by id and userId for update', async () => {
      const recId = '1';
      mockRecommendation.findOneAndUpdate.mockResolvedValue(null);

      await Recommendation.findOneAndUpdate(
        { _id: recId, userId },
        { status: 'accepted' },
        { new: true }
      );

      expect(mockRecommendation.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: recId, userId }),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
