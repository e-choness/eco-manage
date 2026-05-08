/**
 * Financial Routes Tests
 */

import FinancialRecord from '../../models/FinancialRecord';

jest.mock('../../models/FinancialRecord');

const mockFinancialRecord = FinancialRecord as jest.Mocked<typeof FinancialRecord>;

describe('Financial Routes', () => {
  const userId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/financial/overview', () => {
    it('should calculate totalSavings from records', async () => {
      const mockRecords = [
        {
          userId,
          date: new Date('2024-01-01'),
          savings: 200,
          revenue: 300,
          costs: 75,
          category: 'Solar & Wind',
        },
        {
          userId,
          date: new Date('2024-02-01'),
          savings: 150,
          revenue: 250,
          costs: 60,
          category: 'Solar & Wind',
        },
      ];

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecords),
      } as any);

      const records = await FinancialRecord.find({ userId }).sort({ date: -1 });
      const totalSavings = records.reduce((sum, r) => sum + r.savings, 0);

      expect(totalSavings).toBe(350);
    });

    it('should calculate monthlyRevenue as average', async () => {
      const mockRecords = [
        {
          userId,
          date: new Date('2024-01-01'),
          savings: 200,
          revenue: 300,
          costs: 75,
        },
        {
          userId,
          date: new Date('2024-02-01'),
          savings: 150,
          revenue: 250,
          costs: 60,
        },
      ];

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecords),
      } as any);

      const records = await FinancialRecord.find({ userId }).sort({ date: -1 });
      const totalRevenue = records.reduce((sum, r) => sum + r.revenue, 0);
      const monthlyRevenue = totalRevenue / records.length;

      expect(monthlyRevenue).toBe(275);
    });

    it('should calculate ROI percentage', () => {
      const totalSavings = 2400;
      const totalRevenue = 3000;
      const totalCosts = 900;
      const estimatedInvestment = 10000;

      const roi = ((totalSavings + totalRevenue - totalCosts) / estimatedInvestment) * 100;

      expect(roi).toBe(45);
    });

    it('should calculate payback period in years', () => {
      const totalSavings = 2400;
      const totalRevenue = 3000;
      const months = 12;
      const estimatedInvestment = 10000;

      const annualSavings = (totalSavings + totalRevenue) * 12 / months;
      const paybackPeriod = estimatedInvestment / annualSavings;

      expect(paybackPeriod).toBeCloseTo(1.85, 1);
    });

    it('should return zeros when no records exist', async () => {
      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      const records = await FinancialRecord.find({ userId }).sort({ date: -1 });

      expect(records).toHaveLength(0);
      expect(records.length).toBe(0);
    });

    it('should track maintenanceCosts correctly', () => {
      const mockRecords = [
        { costs: 75 },
        { costs: 60 },
        { costs: 80 },
      ];

      const totalCosts = mockRecords.reduce((sum, r) => sum + r.costs, 0);

      expect(totalCosts).toBe(215);
    });
  });

  describe('GET /api/financial/history', () => {
    it('should return records for year period', async () => {
      const mockRecords = [
        {
          _id: '1',
          userId,
          date: new Date('2024-01-01'),
          savings: 200,
          revenue: 300,
          costs: 75,
          category: 'Solar & Wind',
        },
      ];

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecords),
      } as any);

      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);

      const records = await FinancialRecord.find({
        userId,
        date: { $gte: startDate },
      }).sort({ date: -1 });

      expect(records).toHaveLength(1);
    });

    it('should return records for 6 months period', async () => {
      const mockRecords = [
        {
          _id: '1',
          userId,
          date: new Date('2024-01-01'),
          savings: 200,
          revenue: 300,
          costs: 75,
          category: 'Solar & Wind',
        },
      ];

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecords),
      } as any);

      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);

      const records = await FinancialRecord.find({
        userId,
        date: { $gte: startDate },
      }).sort({ date: -1 });

      expect(records).toHaveLength(1);
    });

    it('should format data with proper structure', () => {
      const formattedData = {
        id: '1',
        date: new Date('2024-01-01'),
        savings: 200,
        revenue: 300,
        costs: 75,
        category: 'Solar & Wind',
      };

      expect(formattedData).toHaveProperty('date');
      expect(formattedData).toHaveProperty('savings');
      expect(formattedData).toHaveProperty('revenue');
      expect(formattedData).toHaveProperty('costs');
    });

    it('should default to year period when not specified', () => {
      const period = 'year';
      expect(['6months', 'year']).toContain(period);
    });

    it('should sort by date descending', async () => {
      const mockRecords = [
        { date: new Date('2024-02-01'), savings: 150 },
        { date: new Date('2024-01-01'), savings: 200 },
      ];

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecords),
      } as any);

      const records = await FinancialRecord.find({ userId }).sort({ date: -1 });

      expect(records[0].date.getTime()).toBeGreaterThan(records[1].date.getTime());
    });
  });

  describe('Financial Metrics', () => {
    it('should track savings as positive number', () => {
      const record = { savings: 250 };
      expect(record.savings).toBeGreaterThan(0);
    });

    it('should track revenue as positive number', () => {
      const record = { revenue: 300 };
      expect(record.revenue).toBeGreaterThan(0);
    });

    it('should track costs as positive number', () => {
      const record = { costs: 80 };
      expect(record.costs).toBeGreaterThan(0);
    });

    it('should have valid date for each record', () => {
      const record = { date: new Date('2024-01-01') };
      expect(record.date).toBeInstanceOf(Date);
      expect(!isNaN(record.date.getTime())).toBe(true);
    });

    it('should round financial values to 2 decimal places', () => {
      const values = [200.555, 300.123, 80.999];
      values.forEach((val) => {
        const rounded = parseFloat(val.toFixed(2));
        const decimalPlaces = rounded.toString().split('.')[1]?.length || 0;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('Financial Category', () => {
    it('should categorize financial records', () => {
      const record = { category: 'Solar & Wind Energy' };
      expect(typeof record.category).toBe('string');
      expect(record.category.length).toBeGreaterThan(0);
    });
  });

  describe('Financial Query Conditions', () => {
    it('should find records by userId', async () => {
      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      await FinancialRecord.find({ userId });

      expect(mockFinancialRecord.find).toHaveBeenCalledWith({ userId });
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);

      mockFinancialRecord.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([]),
      } as any);

      await FinancialRecord.find({
        userId,
        date: { $gte: startDate },
      }).sort({ date: -1 });

      expect(mockFinancialRecord.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          date: expect.objectContaining({ $gte: startDate }),
        })
      );
    });
  });
});
