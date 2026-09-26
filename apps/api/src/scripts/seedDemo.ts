import mongoose from 'mongoose';
import { DEMO_CALENDAR_INPUT, DEMO_DEVICES, DEMO_SITE, DEMO_SITE_ID, DEMO_USERS, TARIFF_TEMPLATES } from '@ecomanage/shared';
import { Alert as SiteAlert, Bill, Calendar, Command, Email, FleetVehicle, Maintenance, NotificationPrefs, Recommendation, RuleConfig, RuleMute, Device as SiteDevice, Interval15, Membership, Site, Tariff, Telemetry, deleteSiteFiles, initModels } from '@ecomanage/db';
import User from '../modules/auth/model';
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

// Resets the demo accounts and the v2 demo site (with its alerts and recommendations). Expects an open connection.
export async function seedDemoData(log: Log = () => {}): Promise<SeedSummary> {
    log('🌱 Starting database seeding...');
    await initModels();

    // Clear existing demo data for all demo accounts
    for (const account of DEMO_ACCOUNTS) {
      const existingUser = await User.findOne({ email: account.email });
      if (existingUser) {
        log(`🔄 Clearing existing demo data for ${account.email}...`);
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
      Tariff.deleteMany({ siteId: DEMO_SITE_ID }),
      Bill.deleteMany({ siteId: DEMO_SITE_ID }),
      Calendar.deleteMany({ siteId: DEMO_SITE_ID }),
      SiteAlert.deleteMany({ siteId: DEMO_SITE_ID }),
      Maintenance.deleteMany({ siteId: DEMO_SITE_ID }),
      NotificationPrefs.deleteMany({ siteId: DEMO_SITE_ID }),
      Email.deleteMany({ siteId: DEMO_SITE_ID }),
      Recommendation.deleteMany({ siteId: DEMO_SITE_ID }),
      RuleConfig.deleteMany({ siteId: DEMO_SITE_ID }),
      FleetVehicle.deleteMany({ siteId: DEMO_SITE_ID }),
      RuleMute.deleteMany({ siteId: DEMO_SITE_ID }),
      Command.deleteMany({ siteId: DEMO_SITE_ID }),
      deleteSiteFiles(DEMO_SITE_ID),
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

    // 2. Other demo accounts (v2 members of the demo site, and two users with their own sites)
    log('👥 Creating additional demo accounts...');
    const others = new Map<string, mongoose.Types.ObjectId>();
    for (const account of DEMO_ACCOUNTS.slice(1)) {
      const passwordHash = await generatePasswordHash(account.password);
      const user = await User.create({ email: account.email, password: passwordHash, name: account.name });
      others.set(account.email, user._id as mongoose.Types.ObjectId);
      log(`✅ Created user: ${account.email} (${account.name})`);
    }

    // 3. v2 demo site (Maple Grove School) with its devices and memberships
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
    // Settings → Site and Calendar as App v2 shows them (P2-06)
    const inverters = DEMO_DEVICES.filter((d) => d.type === 'pv');
    await Site.updateOne(
      { _id: DEMO_SITE_ID },
      {
        $set: {
          batteryFloorPct: 10,
          pvArrays: inverters.map((d, i) => ({ id: `arr-${i + 1}`, name: i === 0 ? 'Roof east' : 'Roof west', inverterId: d.id, kwp: d.kwp, tiltDeg: 10, azimuthDeg: 180 })),
        },
      }
    );
    await Calendar.create({ siteId: DEMO_SITE_ID, ...DEMO_CALENDAR_INPUT });
    // The school buses charge on EV chargers 1 and 4 (the simulator's BUS-1 and BUS-2 sessions).
    await FleetVehicle.create([
      { siteId: DEMO_SITE_ID, name: 'Bus 1', rfid: 'BUS-1', capacityKwh: 150, departure: '07:00' },
      { siteId: DEMO_SITE_ID, name: 'Bus 2', rfid: 'BUS-2', capacityKwh: 150, departure: '07:00' },
    ]);

    // Alerts and maintenance notes as App v2 shows them (P2-08). Alerts whose condition no longer
    // holds on the simulator are closed by the rules service as soon as it next evaluates the site.
    const devId = (key: string) => DEMO_DEVICES.find((d) => d.key === key)!.id;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
    const installerId = userIdOf('installer@ecomanage.io');
    await SiteAlert.create([
      {
        siteId: DEMO_SITE_ID,
        deviceId: devId('bat'),
        ruleId: 'command-ack-slow',
        severity: 'info',
        title: 'Command confirmed late',
        detail: 'Battery: peak_shave_target confirmed after 38 s (limit 60 s). The command completed.',
        state: 'open',
        condition: 'cleared',
        openedAt: hoursAgo(3),
        lastSeenAt: hoursAgo(3),
      },
      {
        siteId: DEMO_SITE_ID,
        deviceId: devId('meter'),
        ruleId: 'demand-near-cap',
        severity: 'warning',
        title: 'Demand close to the cap',
        detail: 'Demand reached 112 kW (93% of cap). New monthly peak.',
        state: 'resolved',
        condition: 'cleared',
        openedAt: hoursAgo(16 * 24),
        lastSeenAt: hoursAgo(16 * 24 - 0.25),
        resolvedAt: hoursAgo(16 * 24 - 0.25),
        resolution: { cause: 'Condition cleared', note: '', by: null, auto: true },
      },
    ]);
    await Maintenance.create(
      [
        ['invA', 'Panels cleaned.', '2026-06-12'],
        ['invB', 'Panels cleaned.', '2026-06-12'],
        ['invB', 'String 2 connector replaced.', '2026-08-03'],
        ['bat', 'Firmware 3.2.1 installed. SoH 97%.', '2026-09-02'],
        ['meter', 'CT direction checked at commissioning.', '2024-03-14'],
      ].map(([key, text, day]) => ({ siteId: DEMO_SITE_ID, deviceId: devId(key), at: new Date(`${day}T15:00:00Z`), by: installerId, source: 'visit', text }))
    );

    // Tariff history (App v2: version 3 valid from 1 Apr 2026; earlier rates were a little lower).
    const tou = TARIFF_TEMPLATES[0].tariff;
    const scaled = (f: number, demand: number) => ({
      ...tou,
      periods: tou.periods.map((p) => ({ ...p, rateCents: Math.round(p.rateCents * f * 10) / 10 })),
      demandRateCents: demand,
    });
    await Tariff.insertMany([
      { siteId: DEMO_SITE_ID, version: 1, validFrom: '2024-03-14', ...scaled(0.9, 1200) },
      { siteId: DEMO_SITE_ID, version: 2, validFrom: '2025-04-01', ...scaled(0.94, 1300) },
      { siteId: DEMO_SITE_ID, version: 3, validFrom: '2026-04-01', ...tou },
    ]);
    log('✅ Created tariff versions 1–3');

    const migration = await migrateToV2({ dropLegacy: true });
    log(`✅ Migration: ${migration.sitesCreated} sites created for users without one`);

    log('🚀 Ready to use! Login with any of the demo credentials below:');
    for (const account of DEMO_ACCOUNTS) {
      log(`   ${account.email} / ${account.password} (${account.name})`);
    }

    return { users: DEMO_ACCOUNTS.length, siteDevices: DEMO_DEVICES.length };
}
