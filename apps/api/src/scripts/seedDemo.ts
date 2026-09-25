import mongoose from 'mongoose';
import { DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, DEMO_USERS } from '@ecomanage/shared';
import { Device as SiteDevice, Interval15, Membership, Site, Telemetry, initModels } from '@ecomanage/db';
import User from '../modules/auth/model';
import Alert from '../modules/alerts/model';
import Recommendation from '../modules/optimization/model';
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
  siteDevices: number;
}

type Log = (message: string) => void;

// Resets the demo accounts, their alerts and recommendations, and the v2 demo site. Expects an open connection.
export async function seedDemoData(log: Log = () => {}): Promise<SeedSummary> {
    log('🌱 Starting database seeding...');
    await initModels();

    // Clear existing demo data for all demo accounts
    for (const account of DEMO_ACCOUNTS) {
      const existingUser = await User.findOne({ email: account.email });
      if (existingUser) {
        log(`🔄 Clearing existing demo data for ${account.email}...`);
        await Alert.deleteMany({ userId: existingUser._id });
        await Recommendation.deleteMany({ userId: existingUser._id });
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

    // 2. Create 4 alerts
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

    // 3. Create 4 recommendations
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

    // 4. Other demo accounts (v2 members of the demo site, and two users with their own sites)
    log('👥 Creating additional demo accounts...');
    const others = new Map<string, mongoose.Types.ObjectId>();
    for (const account of DEMO_ACCOUNTS.slice(1)) {
      const passwordHash = await generatePasswordHash(account.password);
      const user = await User.create({ email: account.email, password: passwordHash, name: account.name });
      others.set(account.email, user._id as mongoose.Types.ObjectId);
      log(`✅ Created user: ${account.email} (${account.name})`);
    }

    // 5. v2 demo site (Maple Grove School) with its devices and memberships
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

    const migration = await migrateToV2({ dropLegacy: true });
    log(`✅ Migration: ${migration.sitesCreated} sites created for users without one`);

    log('🚀 Ready to use! Login with any of the demo credentials below:');
    for (const account of DEMO_ACCOUNTS) {
      log(`   ${account.email} / ${account.password} (${account.name})`);
    }

    return { users: DEMO_ACCOUNTS.length, siteDevices: DEMO_DEVICES.length };
}
