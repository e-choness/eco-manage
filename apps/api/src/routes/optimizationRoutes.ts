import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import Recommendation from '../models/Recommendation';

const router = Router();

// GET /api/optimization/recommendations
router.get('/recommendations', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const recommendations = await Recommendation.find({
      userId: req.user._id,
      status: { $in: ['pending', 'accepted'] },
    }).sort({ priority: -1, createdAt: -1 });

    res.json({ recommendations });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Recommendations fetch error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// POST /api/optimization/accept
router.post('/accept', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { recommendationId } = req.body;

    if (!recommendationId) {
      res.status(400).json({ error: 'Missing recommendationId' });
      return;
    }

    const recommendation = await Recommendation.findOneAndUpdate(
      { _id: recommendationId, userId: req.user._id },
      { status: 'accepted' },
      { new: true }
    );

    if (!recommendation) {
      res.status(404).json({ error: 'Recommendation not found' });
      return;
    }

    res.json(recommendation);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Recommendation accept error: ${err.message}`);
    res.status(500).json({ error: 'Failed to accept recommendation' });
  }
});

export default router;
