import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from '../config/logger';
import { migrateToV2 } from './migrateV2';

// `pnpm --filter @ecomanage/api migrate [-- --drop-legacy]`: brings an existing v1 database to the
// v2 model; --drop-legacy also deletes the retired v1 collections.
dotenv.config();

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  await mongoose.connect(url);
  logger.info(await migrateToV2({ dropLegacy: process.argv.includes('--drop-legacy') }), 'migration finished');
  await mongoose.disconnect();
};

main().catch((err: Error) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'migration failed');
  process.exit(1);
});
