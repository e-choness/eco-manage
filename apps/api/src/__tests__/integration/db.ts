import mongoose from 'mongoose';
import { initModels } from '@ecomanage/db';

// Integration tests run against the compose MongoDB (a separate database per test file).
// Run them inside the docker network: `docker compose run --rm api pnpm --filter @ecomanage/api test`.
const BASE_URL = process.env.MONGO_TEST_URL || 'mongodb://mongodb:27017';

export const connectTestDb = async (name: string): Promise<void> => {
  await mongoose.connect(`${BASE_URL}/ecomanage_test_${name}`, { serverSelectionTimeoutMS: 5000 });
  // A clean database, then its collections and indexes (Mongoose's automatic creation is off).
  await mongoose.connection.dropDatabase();
  await initModels();
};

export const disconnectTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

