import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import Device from '../models/Device';
import EnergyReading from '../models/EnergyReading';
import Alert from '../models/Alert';
import FinancialRecord from '../models/FinancialRecord';
import Recommendation from '../models/Recommendation';
import Weather from '../models/Weather';
import { generatePasswordHash } from '../utils/password';

dotenv.config();

const DEMO_EMAIL = 'demo@ecomanage.io';
const DEMO_PASSWORD = 'Demo1234!';

async function seed() {
  try {
    console.log('🌱 Starting database seeding...');

    // Connect to MongoDB
    const mongoUrl = process.env.DATABASE_URL;
    if (!mongoUrl) {
      throw new Error('DATABASE_URL not set');
    }

    await mongoose.connect(mongoUrl);
    console.log('✅ Connected to MongoDB');

    // Clear existing demo data
    const existingUser = await User.findOne({ email: DEMO_EMAIL });
    if (existingUser) {
      console.log('🔄 Clearing existing demo data...');
      await Alert.deleteMany({ userId: existingUser._id });
      await Device.deleteMany({ userId: existingUser._id });
      await EnergyReading.deleteMany({ userId: existingUser._id });
      await FinancialRecord.deleteMany({ userId: existingUser._id });
      await Recommendation.deleteMany({ userId: existingUser._id });
      await Weather.deleteMany({ userId: existingUser._id });
      await User.deleteOne({ email: DEMO_EMAIL });
      console.log('✅ Cleared existing demo data');
    }

    // 1. Create demo user
    console.log('\n📝 Creating demo user...');
    const passwordHash = await generatePasswordHash(DEMO_PASSWORD);
    const demoUser = await User.create({
      email: DEMO_EMAIL,
      password: passwordHash,
      name: 'Demo User',
    });
    console.log(`✅ Created user: ${DEMO_EMAIL}`);

    // 2. Create 4 devices
    console.log('\n🔌 Creating devices...');

    // Calculate current solar output based on time of day (peaks at noon)
    const now = new Date();
    const hour = now.getHours();
    const solarFraction = hour >= 6 && hour <= 18
      ? Math.sin(((hour - 6) / 12) * Math.PI) * 0.8 + 0.2
      : 0;

    // Wind is relatively constant with some random variation
    const windFraction = 0.6 + Math.random() * 0.3;

    const devices = await Device.create([
      {
        userId: demoUser._id,
        name: 'Solar Panel A',
        type: 'solar',
        status: 'online',
        currentOutput: solarFraction * 5.5 * 0.6, // 60% of Solar B
        maxOutput: 5.5,
        efficiency: 95,
        lastMaintenance: new Date(),
      },
      {
        userId: demoUser._id,
        name: 'Solar Panel B',
        type: 'solar',
        status: 'online',
        currentOutput: solarFraction * 5.5,
        maxOutput: 5.5,
        efficiency: 92,
        lastMaintenance: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
      {
        userId: demoUser._id,
        name: 'Wind Turbine 1',
        type: 'wind',
        status: 'online',
        currentOutput: windFraction * 10.0,
        maxOutput: 10.0,
        efficiency: 85,
        lastMaintenance: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
      {
        userId: demoUser._id,
        name: 'Battery Storage',
        type: 'battery',
        status: 'charging',
        currentOutput: 8.0, // Half charged
        maxOutput: 15.0,
        efficiency: 97,
        lastMaintenance: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    ]);
    console.log(`✅ Created ${devices.length} devices`);

    // 3. Generate 365 days of energy readings
    console.log('\n⚡ Generating energy readings (365 days × 24 hours)...');
    const energyReadings: any[] = [];
    const energyStartDate = new Date();
    const startDate = new Date(energyStartDate.getFullYear(), 0, 1); // Jan 1 of current year

    // Solar sine curve pattern + wind random pattern
    for (let dayOfYear = 0; dayOfYear < 365; dayOfYear++) {
      for (let hour = 0; hour < 24; hour++) {
        const timestamp = new Date(startDate);
        timestamp.setDate(timestamp.getDate() + dayOfYear);
        timestamp.setHours(hour, 0, 0, 0);

        // Solar production (sine curve, peaks at noon, 0 at night)
        const solarHourFraction = (hour - 6) / 12; // Peak at hour 6-18 (6am-6pm)
        const solarProduction = solarHourFraction > 0 && solarHourFraction < 1
          ? Math.sin(solarHourFraction * Math.PI) * 5.5
          : 0;

        // Add some daily variation
        const dayVariation = Math.sin(dayOfYear * (2 * Math.PI / 365)) * 0.8 + 0.2;

        // Production readings for Solar A
        energyReadings.push({
          deviceId: devices[0]._id,
          userId: demoUser._id,
          timestamp,
          value: Math.max(0, solarProduction * dayVariation * 0.6), // 60% of solar B
          type: 'production',
        });

        // Production readings for Solar B
        energyReadings.push({
          deviceId: devices[1]._id,
          userId: demoUser._id,
          timestamp,
          value: Math.max(0, solarProduction * dayVariation),
          type: 'production',
        });

        // Wind production (random with seasonal variation)
        const windBase = Math.sin(dayOfYear * (2 * Math.PI / 365)) * 3 + 5;
        const windVariation = Math.random() * 4;
        energyReadings.push({
          deviceId: devices[2]._id,
          userId: demoUser._id,
          timestamp,
          value: Math.max(0, windBase + windVariation),
          type: 'production',
        });

        // Consumption (baseline + peak hours)
        const consumptionBase = 2.5; // Base load
        const peakHour = (hour >= 7 && hour <= 9) || (hour >= 18 && hour <= 21) ? 2 : 0;
        const consumption = consumptionBase + peakHour + Math.random() * 1;

        energyReadings.push({
          deviceId: devices[3]._id, // Battery tracks consumption
          userId: demoUser._id,
          timestamp,
          value: consumption,
          type: 'consumption',
        });
      }
    }

    await EnergyReading.insertMany(energyReadings);
    console.log(`✅ Created ${energyReadings.length} energy readings`);

    // 4. Create 4 alerts
    console.log('\n🚨 Creating alerts...');
    const alerts = await Alert.create([
      {
        userId: demoUser._id,
        title: 'Solar Panel B Efficiency Low',
        message: 'Panel efficiency dropped to 92%. Schedule maintenance check.',
        type: 'warning',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        read: false,
        resolved: false,
      },
      {
        userId: demoUser._id,
        title: 'Battery Storage Charging',
        message: 'Battery is currently charging. Estimated 2 hours to full capacity.',
        type: 'info',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        read: true,
        resolved: true,
      },
      {
        userId: demoUser._id,
        title: 'High Energy Consumption Detected',
        message: 'Energy consumption peaked at 8.5 kW during peak hours today.',
        type: 'warning',
        timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
        read: false,
        resolved: false,
      },
      {
        userId: demoUser._id,
        title: 'Maintenance Due',
        message: 'Wind Turbine 1 maintenance is due soon. Schedule for next week.',
        type: 'critical',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
        read: false,
        resolved: false,
      },
    ]);
    console.log(`✅ Created ${alerts.length} alerts`);

    // 5. Create 12 months of financial records
    console.log('\n💰 Creating financial records (12 months)...');
    const financialRecords: any[] = [];
    const currentYear = new Date().getFullYear();

    for (let month = 0; month < 12; month++) {
      const date = new Date(currentYear, month, 1);

      // Realistic financial metrics
      const savings = 150 + Math.random() * 100; // $150-250 monthly savings
      const revenue = 200 + Math.random() * 150; // $200-350 from excess power
      const costs = 50 + Math.random() * 30; // $50-80 maintenance/operational

      financialRecords.push({
        userId: demoUser._id,
        date,
        savings: Math.round(savings * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        costs: Math.round(costs * 100) / 100,
        category: 'Solar & Wind Energy',
      });
    }

    await FinancialRecord.insertMany(financialRecords);
    console.log(`✅ Created ${financialRecords.length} financial records`);

    // 6. Create 4 recommendations
    console.log('\n💡 Creating recommendations...');
    const recommendations = await Recommendation.create([
      {
        userId: demoUser._id,
        title: 'Install Additional Solar Panels',
        description:
          'Adding 5 more solar panels could increase daily production by 25% and reduce grid dependency.',
        priority: 'high',
        estimatedSavings: 500,
        difficulty: 'medium',
        category: 'Solar Expansion',
        status: 'pending',
      },
      {
        userId: demoUser._id,
        title: 'Upgrade Battery Storage',
        description:
          'Current battery capacity could be doubled to store more excess energy during peak production.',
        priority: 'high',
        estimatedSavings: 300,
        difficulty: 'hard',
        category: 'Energy Storage',
        status: 'pending',
      },
      {
        userId: demoUser._id,
        title: 'Schedule Maintenance for Solar Panel B',
        description:
          'Panel B efficiency has dropped. Professional cleaning and inspection recommended.',
        priority: 'medium',
        estimatedSavings: 50,
        difficulty: 'easy',
        category: 'Maintenance',
        status: 'pending',
      },
      {
        userId: demoUser._id,
        title: 'Optimize Peak Hour Usage',
        description:
          'Shift major appliance usage to off-peak hours to reduce consumption during 6-9pm window.',
        priority: 'medium',
        estimatedSavings: 75,
        difficulty: 'easy',
        category: 'Usage Optimization',
        status: 'pending',
      },
    ]);
    console.log(`✅ Created ${recommendations.length} recommendations`);

    // 7. Create weather data
    console.log('\n🌤️ Creating weather data...');
    const weather = await Weather.create({
      userId: demoUser._id,
      condition: 'sunny',
      temperature: 22,
      humidity: 65,
      windSpeed: 8,
      uvIndex: 6,
    });
    console.log(`✅ Created weather data: ${weather.condition}, ${weather.temperature}°C`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('✨ SEEDING COMPLETE ✨');
    console.log('='.repeat(60));
    console.log(`\n📊 Demo Data Summary:`);
    console.log(`   User: ${DEMO_EMAIL}`);
    console.log(`   Password: ${DEMO_PASSWORD}`);
    console.log(`   Devices: ${devices.length}`);
    console.log(`   Energy Readings: ${energyReadings.length} (365 days × 24 hours × 4 devices)`);
    console.log(`   Alerts: ${alerts.length}`);
    console.log(`   Financial Records: ${financialRecords.length} months`);
    console.log(`   Recommendations: ${recommendations.length}`);
    console.log(`   Weather: 1 (Current weather data)`);
    console.log('\n🚀 Ready to use! Login with the demo credentials above.\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('\n❌ Seeding failed:');
    console.error(err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

seed();
