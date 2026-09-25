import mongoose from 'mongoose';
import { initModels } from '@ecomanage/db';

// Integration tests run against the compose MongoDB (a separate database per test file).
// Run them inside the docker network: `docker compose run --rm api pnpm --filter @ecomanage/api test`.
const BASE_URL = process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017';

export const connectTestDb = async (name: string): Promise<void> => {
  await mongoose.connect(`${BASE_URL}/ecomanage_test_${name}`, { serverSelectionTimeoutMS: 5000 });
  // Mongoose creates collections on connect; let that finish before dropping, then recreate
  // them (the time series explicitly), or a first deleteMany can race the creation.
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  await mongoose.connection.dropDatabase();
  await initModels();
};

export const disconnectTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

// Counts queries per collection so tests can assert on query patterns.
export const countQueries = (): { counts: Record<string, number>; stop: () => void } => {
  const counts: Record<string, number> = {};
  mongoose.set('debug', (collection: string) => {
    counts[collection] = (counts[collection] ?? 0) + 1;
  });
  return { counts, stop: () => mongoose.set('debug', false) };
};
