import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import EnergyReading from '../models/EnergyReading';
import { sendLLMRequest } from '../services/llmService';

const router = Router();

// Helper function to calculate period dates
function getPeriodDates(period: string = 'month'): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();

  switch (period.toLowerCase()) {
    case 'week':
      startDate.setDate(endDate.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(endDate.getMonth() - 1);
      break;
    case 'year':
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
    default:
      startDate.setMonth(endDate.getMonth() - 1);
  }

  return { startDate, endDate };
}

// GET /api/analytics/production?period=week|month|year
router.get('/production', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const period = (req.query.period as string) || 'month';
    const { startDate, endDate } = getPeriodDates(period);

    // Get all production readings for the period
    const readings = await EnergyReading.find({
      userId: req.user._id,
      type: 'production',
      timestamp: { $gte: startDate, $lte: endDate },
    }).sort({ timestamp: 1 });

    // Group by day
    const dailyData: { [key: string]: number } = {};

    readings.forEach((reading) => {
      const day = new Date(reading.timestamp).toISOString().split('T')[0];
      if (!dailyData[day]) {
        dailyData[day] = 0;
      }
      dailyData[day] += reading.value;
    });

    // Convert to array format
    const data = Object.entries(dailyData).map(([date, value]) => ({
      date,
      production: parseFloat(value.toFixed(2)),
    }));

    res.json({ period, data });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Analytics production error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch production analytics' });
  }
});

// GET /api/analytics/consumption?period=week|month|year
router.get('/consumption', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const period = (req.query.period as string) || 'month';
    const { startDate, endDate } = getPeriodDates(period);

    // Get all consumption readings for the period
    const readings = await EnergyReading.find({
      userId: req.user._id,
      type: 'consumption',
      timestamp: { $gte: startDate, $lte: endDate },
    }).sort({ timestamp: 1 });

    // Group by day
    const dailyData: { [key: string]: number } = {};

    readings.forEach((reading) => {
      const day = new Date(reading.timestamp).toISOString().split('T')[0];
      if (!dailyData[day]) {
        dailyData[day] = 0;
      }
      dailyData[day] += reading.value;
    });

    // Convert to array format
    const data = Object.entries(dailyData).map(([date, value]) => ({
      date,
      consumption: parseFloat(value.toFixed(2)),
    }));

    res.json({ period, data });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Analytics consumption error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch consumption analytics' });
  }
});

// POST /api/analytics/insight
router.post('/insight', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data } = req.body;

    if (!data) {
      res.status(400).json({ error: 'Missing data field' });
      return;
    }

    // Format the prompt for the LLM
    const prompt = `Based on the following energy data for a renewable energy system, provide a brief insight and recommendation:

${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}

Please provide a concise insight (2-3 sentences) about the energy usage patterns and one actionable recommendation.`;

    // Call LLM service
    const insight = await sendLLMRequest(prompt);

    res.json({ insight });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Analytics insight error: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate insight' });
  }
});

export default router;
