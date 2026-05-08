import { Router, Response } from 'express';
import { AuthenticatedRequest, requireUser } from './middleware/auth';
import EnergyReading from '../models/EnergyReading';
import Device from '../models/Device';
import Weather from '../models/Weather';

const router = Router();

// GET /api/dashboard/overview - Get dashboard overview
router.get('/overview', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get readings from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const readings = await EnergyReading.find({
      userId: req.user._id,
      timestamp: { $gte: thirtyDaysAgo },
    });

    // Aggregate production (sum of production readings)
    const totalProduction = readings
      .filter(r => r.type === 'production')
      .reduce((sum, r) => sum + r.value, 0);

    // Current power (latest reading value)
    const latestReading = await EnergyReading.findOne({
      userId: req.user._id,
    })
      .sort({ timestamp: -1 })
      .exec();

    const currentPower = latestReading?.value || 0;

    // Daily average
    const dailyProduction = totalProduction / 30;

    // Monthly projection
    const monthlyProduction = dailyProduction * 30;

    // System status (count of online devices vs total devices)
    const devices = await Device.find({ userId: req.user._id });
    const onlineDevices = devices.filter(d => d.status === 'online').length;
    const systemStatus = devices.length > 0 ? ((onlineDevices / devices.length) * 100).toFixed(1) : '0';

    // Estimated savings (roughly $0.12 per kWh)
    const savings = (totalProduction * 0.12).toFixed(2);

    // Carbon offset (roughly 0.5 kg CO2 per kWh)
    const carbonOffset = (totalProduction * 0.5).toFixed(2);

    // Weather data (from database)
    const weather = await Weather.findOne({ userId: req.user._id });
    const weatherCondition = weather?.condition || 'sunny';
    const temperature = weather?.temperature || 22;

    res.json({
      totalProduction: parseFloat(totalProduction.toFixed(2)),
      currentPower: parseFloat(currentPower.toFixed(2)),
      dailyProduction: parseFloat(dailyProduction.toFixed(2)),
      monthlyProduction: parseFloat(monthlyProduction.toFixed(2)),
      systemStatus: parseFloat(systemStatus as string),
      weatherCondition,
      temperature,
      savings: parseFloat(savings),
      carbonOffset: parseFloat(carbonOffset),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Dashboard overview error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch dashboard overview' });
  }
});

// GET /api/dashboard/energy-flow - Get current energy flow breakdown
router.get('/energy-flow', requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get most recent reading for each device
    const devices = await Device.find({ userId: req.user._id });

    const deviceReadings = await Promise.all(
      devices.map(async device => {
        const latestReading = await EnergyReading.findOne({
          userId: req.user._id,
          deviceId: device._id,
        })
          .sort({ timestamp: -1 })
          .exec();

        return {
          deviceId: device._id,
          deviceName: device.name,
          type: device.type,
          value: latestReading?.value || 0,
        };
      })
    );

    // Group by type and sum
    const solar = deviceReadings
      .filter(r => r.type === 'solar')
      .reduce((sum, r) => sum + r.value, 0);

    const wind = deviceReadings
      .filter(r => r.type === 'wind')
      .reduce((sum, r) => sum + r.value, 0);

    const battery = deviceReadings
      .filter(r => r.type === 'battery')
      .reduce((sum, r) => sum + r.value, 0);

    const grid = deviceReadings
      .filter(r => r.type === 'grid')
      .reduce((sum, r) => sum + r.value, 0);

    // Consumption is tracked separately
    const consumption = deviceReadings
      .filter(r => r.type === 'battery') // Battery tracks consumption
      .reduce((sum, r) => sum + r.value, 0);

    res.json({
      solar: parseFloat(solar.toFixed(2)),
      wind: parseFloat(wind.toFixed(2)),
      battery: parseFloat(battery.toFixed(2)),
      grid: parseFloat(grid.toFixed(2)),
      consumption: parseFloat(consumption.toFixed(2)),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`Energy flow error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch energy flow' });
  }
});

export default router;
