import mongoose from 'mongoose';
import { initModels } from '@ecomanage/db';
import { nightlyBills } from '../billing';

// `docker compose exec worker pnpm --filter @ecomanage/worker bills:refresh`
// Recomputes the current and the previous bill of every site now, instead of at each site's
// 1 am. A freshly seeded stack has no bill until its first interval is priced, so CI runs this
// after seeding before the e2e suite opens the Bills page.

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  await mongoose.connect(url);
  await initModels();
  const sites = await nightlyBills(new Date(), null);
  console.log(`Refreshed the bills of ${sites} site(s)`);
  await mongoose.disconnect();
};

main().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});
