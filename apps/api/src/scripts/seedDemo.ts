import mongoose from 'mongoose';
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, DEMO_USERS } from '@ecomanage/shared';
import { Device as SiteDevice, Interval15, Membership, Site, Telemetry, initModels } from '@ecomanage/db';
import User from '../modules/auth/model';
import Device from '../modules/devices/model';
import EnergyReading from '../modules/analytics/model';
import { buildSeedReadings } from './seedReadings';
import Alert from '../modules/alerts/model';
import FinancialRecord, { IFinancialRecord } from '../modules/financial/model';
import Recommendation from '../modules/optimization/model';
import Weather from '../modules/dashboard/model';
import { generatePasswordHash } from '../utils/password';
import { migrateToV2 } from './migrateV2';

const DEMO_EMAIL = 'demo@ecomanage.io';
const DEMO_PASSWORD = 'Demo1234!';

// demo@ holds the v1 data and owns the demo site. manager@ and installer@ are v2 members of the
// demo site. demo2@ and demo3@ get their own empty sites from the migration.
const DEMO_ACCOUNTS = [
  ...DEMO_USERS.map((u) => ({ email: u.email, password: DEMO_PASSWORD, name: u.name })),
  { email: 'demo2@ecomanage.io', password: DEMO_PASSWORD, name: 'Alice Johnson' },
  { email: 'demo3@ecomanage.io', password: DEMO_PASSWORD, name: 'Bob Williams' },
];

export interface SeedSummary {
  users: number;
  legacyReadings: number;
  siteDevices: number;
}

type Log = (message: string) => void;

// Resets the demo accounts, their v1 data and the v2 demo site. Expects an open connection.
export async function seedDemoData(log: Log = () => {}, now = new Date()): Promise<SeedSummary> {
    log('🌱 Starting database seeding...');
    await initModels();

    // Clear existing demo data for all demo accounts
    for (const account of DEMO_ACCOUNTS) {
      const existingUser = await User.findOne({ email: account.email });
      if (existingUser) {
        log(`🔄 Clearing existing demo data for ${account.email}...`);
        await Alert.deleteMany({ userId: existingUser._id });
        await Device.deleteMany({ userId: existingUser._id });
        await EnergyReading.deleteMany({ userId: existingUser._id });
        await FinancialRecord.deleteMany({ userId: existingUser._id });
        await Recommendation.deleteMany({ userId: existingUser._id });
        await Weather.deleteMany({ userId: existingUser._id });
        const memberships = await Membership.find({ userId: existingUser._id });
        const ownSites = memberships.filter((m) => m.role === 'owner' && String(m.siteId) !== DEMO_SITE_ID).map((m) => m.siteId);
        await Site.deleteMany({ _id: { $in: ownSites } });
        await Membership.deleteMany({ $or: [{ userId: existingUser._id }, { siteId: { $in: ownSites } }] });
        await User.deleteOne({ email: account.email });
      }
    }
    await Promise.all([
      Site.deleteOne({ _id: DEMO_SITE_ID }),
      Membership.deleteMany({ siteId: DEMO_SITE_ID }),
      SiteDevice.deleteMany({ siteId: DEMO_SITE_ID }),
      Telemetry.deleteMany({ 'meta.siteId': new mongoose.Types.ObjectId(DEMO_SITE_ID) }),
      Interval15.deleteMany({ siteId: DEMO_SITE_ID }),
    ]);
    log('✅ Cleared existing demo data');

    // 1. Create demo user
    log('\n📝 Creating demo user...');
    const passwordHash = await generatePasswordHash(DEMO_PASSWORD);
    const demoUser = await User.create({
      email: DEMO_EMAIL,
      password: passwordHash,
      name: DEMO_USERS[0].name,
    });
    log(`✅ Created user: ${DEMO_EMAIL}`);

    // 2. Create 5 devices
    log('\n🔌 Creating devices...');

    // Calculate current solar output based on time of day (peaks at noon)
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
      {
        userId: demoUser._id,
        name: 'Grid Meter',
        type: 'grid',
        status: 'online',
        currentOutput: 0,
        maxOutput: 50.0,
        efficiency: 100,
        lastMaintenance: new Date(),
      },
    ]);
    log(`✅ Created ${devices.length} devices`);

    // 3. Generate 365 days of hourly energy readings up to now
    log('\n⚡ Generating energy readings (365 days × 24 hours)...');
    const energyReadings = buildSeedReadings(demoUser._id as mongoose.Types.ObjectId, {
      solarA: devices[0]._id as mongoose.Types.ObjectId,
      solarB: devices[1]._id as mongoose.Types.ObjectId,
      wind: devices[2]._id as mongoose.Types.ObjectId,
      gridMeter: devices[4]._id as mongoose.Types.ObjectId,
    }, now);
    await EnergyReading.insertMany(energyReadings);
    log(`✅ Created ${energyReadings.length} energy readings`);

    // 4. Create 4 alerts
    log('\n🚨 Creating alerts...');
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
    log(`✅ Created ${alerts.length} alerts`);

    // 5. Create 24 months of financial records
    log('\n💰 Creating financial records (24 months)...');
    const financialRecords: Partial<IFinancialRecord>[] = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();

    for (let offset = 23; offset >= 0; offset--) {
      const date = new Date(currentYear, currentDate.getMonth() - offset, 1);

      // Realistic financial metrics with seasonal variation
      const seasonalFactor = 0.6 + 0.4 * Math.sin((offset / 12) * Math.PI);
      const savings = Math.round((150 + Math.random() * 100) * seasonalFactor * 100) / 100;
      const revenue = Math.round((200 + Math.random() * 150) * seasonalFactor * 100) / 100;
      const costs = Math.round((50 + Math.random() * 30) * 100) / 100;

      financialRecords.push({
        userId: demoUser._id,
        date,
        savings,
        revenue,
        costs,
        category: 'Solar & Wind Energy',
      });
    }

    await FinancialRecord.insertMany(financialRecords);
    log(`✅ Created ${financialRecords.length} financial records`);

    // 6. Create 4 recommendations
    log('\n💡 Creating recommendations...');
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
    log(`✅ Created ${recommendations.length} recommendations`);

    // 7. Create weather data
    log('\n🌤️ Creating weather data...');
    const weather = await Weather.create({
      userId: demoUser._id,
      condition: 'sunny',
      temperature: 22,
      humidity: 65,
      windSpeed: 8,
      uvIndex: 6,
    });
    log(`✅ Created weather data: ${weather.condition}, ${weather.temperature}°C`);

    // 8. Other demo accounts (v2 members of the demo site, and two users with their own sites)
    log('👥 Creating additional demo accounts...');
    const others = new Map<string, mongoose.Types.ObjectId>();
    for (const account of DEMO_ACCOUNTS.slice(1)) {
      const passwordHash = await generatePasswordHash(account.password);
      const user = await User.create({ email: account.email, password: passwordHash, name: account.name });
      others.set(account.email, user._id as mongoose.Types.ObjectId);
      log(`✅ Created user: ${account.email} (${account.name})`);
    }

    // 9. v2 demo site (Maple Grove School) with its devices and memberships
    log('🏫 Creating the demo site...');
    await Site.create({ _id: DEMO_SITE_ID, ...DEMO_SITE });
    const userIdOf = (email: string) => (email === DEMO_EMAIL ? (demoUser._id as mongoose.Types.ObjectId) : others.get(email));
    await Membership.insertMany(
      DEMO_USERS.map((u) => ({ userId: userIdOf(u.email), siteId: DEMO_SITE_ID, role: u.role, until: u.until ? new Date(u.until) : null }))
    );
    const commissionedAt = new Date('2024-03-14T15:00:00Z');
    await SiteDevice.insertMany(
      DEMO_DEVICES.map((d) => ({
        _id: d.id,
        siteId: DEMO_SITE_ID,
        type: d.type,
        name: d.name,
        profileId: d.profileId,
        address: d.address,
        role: d.role,
        status: 'live',
        ratedKw: d.ratedKw,
        capacityKwh: d.capacityKwh,
        commissionedAt,
        commissionedBy: userIdOf('installer@ecomanage.io'),
      }))
    );
    log(`✅ Created ${DEMO_SITE.name} with ${DEMO_DEVICES.length} devices`);

    const migration = await migrateToV2();
    log(`✅ Migration: ${migration.sitesCreated} sites created for users without one`);

    log('🚀 Ready to use! Login with any of the demo credentials below:');
    for (const account of DEMO_ACCOUNTS) {
      log(`   ${account.email} / ${account.password} (${account.name})`);
    }

    return { users: DEMO_ACCOUNTS.length, legacyReadings: energyReadings.length, siteDevices: DEMO_DEVICES.length };
}
