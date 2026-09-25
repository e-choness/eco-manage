import FinancialRecord, { IFinancialRecord } from './model';

export interface FinancialOverview {
  totalSavings: number;
  monthlyRevenue: number;
  roi: number;
  paybackPeriod: number;
  maintenanceCosts: number;
}

export interface FinancialHistoryItem {
  id: unknown;
  date: Date;
  savings: number;
  revenue: number;
  costs: number;
  category: string;
}

const round2 = (n: number): number => parseFloat(n.toFixed(2));

// '6months' looks back six months; anything else looks back a year.
export const periodStart = (period: string, now = new Date()): Date => {
  const start = new Date(now);
  if (period === '6months') start.setMonth(start.getMonth() - 6);
  else start.setFullYear(start.getFullYear() - 1);
  return start;
};

const recordsSince = (userId: string, start: Date): Promise<IFinancialRecord[]> =>
  FinancialRecord.find({ userId, date: { $gte: start } }).sort({ date: -1 });

export const overview = async (userId: string, period: string): Promise<FinancialOverview> => {
  const records = await recordsSince(userId, periodStart(period));
  if (records.length === 0) {
    return { totalSavings: 0, monthlyRevenue: 0, roi: 0, paybackPeriod: 0, maintenanceCosts: 0 };
  }

  const totalSavings = records.reduce((sum, r) => sum + r.savings, 0);
  const totalRevenue = records.reduce((sum, r) => sum + r.revenue, 0);
  const totalCosts = records.reduce((sum, r) => sum + r.costs, 0);
  const monthlyRevenue = totalRevenue / records.length;

  // Simple ROI calculation: (savings + revenue - costs) / total investment (estimated)
  const estimatedInvestment = 10000; // Placeholder for system investment
  const roi = ((totalSavings + totalRevenue - totalCosts) / estimatedInvestment) * 100;

  // Simple payback period: investment / annual savings
  const annualSavings = ((totalSavings + totalRevenue) * 12) / records.length;
  const paybackPeriod = annualSavings > 0 ? estimatedInvestment / annualSavings : 0;

  return {
    totalSavings: round2(totalSavings),
    monthlyRevenue: round2(monthlyRevenue),
    roi: round2(roi),
    paybackPeriod: round2(paybackPeriod),
    maintenanceCosts: round2(totalCosts),
  };
};

export const history = async (userId: string, period: string): Promise<FinancialHistoryItem[]> => {
  const records = await recordsSince(userId, periodStart(period));
  return records.map((r) => ({
    id: r._id,
    date: r.date,
    savings: round2(r.savings),
    revenue: round2(r.revenue),
    costs: round2(r.costs),
    category: r.category,
  }));
};
