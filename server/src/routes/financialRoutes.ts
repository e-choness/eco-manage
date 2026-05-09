import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import FinancialRecord from '../models/FinancialRecord';

const router = Router();

// GET /api/financial/overview?period=year|6months - Get financial overview
router.get('/overview', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const period = (req.query.period as string) || 'year';
    const startDate = new Date();
    if (period === '6months') {
      startDate.setMonth(startDate.getMonth() - 6);
    } else {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const records = await FinancialRecord.find({
      userId: req.user._id,
      date: { $gte: startDate },
    }).sort({ date: -1 });

    if (records.length === 0) {
      res.json({
        totalSavings: 0,
        monthlyRevenue: 0,
        roi: 0,
        paybackPeriod: 0,
        maintenanceCosts: 0,
      });
      return;
    }

    // Calculate totals
    const totalSavings = records.reduce((sum, r) => sum + r.savings, 0);
    const totalRevenue = records.reduce((sum, r) => sum + r.revenue, 0);
    const totalCosts = records.reduce((sum, r) => sum + r.costs, 0);
    const monthlyRevenue = records.length > 0 ? totalRevenue / records.length : 0;
    const maintenanceCosts = totalCosts;

    // Simple ROI calculation: (savings + revenue - costs) / total investment (estimated)
    const estimatedInvestment = 10000; // Placeholder for system investment
    const roi = ((totalSavings + totalRevenue - totalCosts) / estimatedInvestment) * 100;

    // Simple payback period: investment / annual savings
    const annualSavings = (totalSavings + totalRevenue) * 12 / records.length;
    const paybackPeriod = annualSavings > 0 ? estimatedInvestment / annualSavings : 0;

    res.json({
      totalSavings: parseFloat(totalSavings.toFixed(2)),
      monthlyRevenue: parseFloat(monthlyRevenue.toFixed(2)),
      roi: parseFloat(roi.toFixed(2)),
      paybackPeriod: parseFloat(paybackPeriod.toFixed(2)),
      maintenanceCosts: parseFloat(maintenanceCosts.toFixed(2)),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Financial overview error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch financial overview' });
  }
});

// GET /api/financial/history?period=year|6months
router.get('/history', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const period = (req.query.period as string) || 'year';
    const startDate = new Date();

    if (period === '6months') {
      startDate.setMonth(startDate.getMonth() - 6);
    } else {
      // Default to 1 year
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const records = await FinancialRecord.find({
      userId: req.user._id,
      date: { $gte: startDate },
    }).sort({ date: -1 });

    const data = records.map((r) => ({
      id: r._id,
      date: r.date,
      savings: parseFloat(r.savings.toFixed(2)),
      revenue: parseFloat(r.revenue.toFixed(2)),
      costs: parseFloat(r.costs.toFixed(2)),
      category: r.category,
    }));

    res.json({ period, data });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Financial history error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch financial history' });
  }
});

export default router;
