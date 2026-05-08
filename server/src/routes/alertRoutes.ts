import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import Alert from '../models/Alert';

const router = Router();

// GET /api/alerts - Get all alerts for user
router.get('/', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const alerts = await Alert.find({ userId: req.user._id }).sort({ timestamp: -1 });

    res.json(alerts);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Alerts fetch error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// PUT /api/alerts/read - Mark alert as read
router.put('/read', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { alertId } = req.body;

    if (!alertId) {
      res.status(400).json({ error: 'Missing alertId' });
      return;
    }

    const alert = await Alert.findOneAndUpdate(
      { _id: alertId, userId: req.user._id },
      { read: true },
      { new: true }
    );

    if (!alert) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }

    res.json(alert);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Alert update error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

export default router;
