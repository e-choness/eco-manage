import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import Device from '../models/Device';

const router = Router();

// GET /api/devices - Get all devices for user
router.get('/', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const devices = await Device.find({ userId: req.user._id }).sort({ createdAt: -1 });

    res.json(devices);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Devices fetch error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// POST /api/devices - Create new device
router.post('/', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, type, maxOutput } = req.body;

    // Validate required fields
    if (!name || !type) {
      res.status(400).json({ error: 'Missing required fields: name, type' });
      return;
    }

    // Validate type enum
    const validTypes = ['solar', 'wind', 'battery', 'grid'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'Invalid device type. Must be: solar, wind, battery, or grid' });
      return;
    }

    const device = await Device.create({
      userId: req.user._id,
      name,
      type,
      maxOutput: maxOutput || 5.0,
      status: 'online',
      efficiency: 90,
      lastMaintenance: new Date(),
    });

    res.status(201).json(device);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Device creation error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create device' });
  }
});

export default router;
