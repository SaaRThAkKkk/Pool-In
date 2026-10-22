import 'dotenv/config';
import mongoose from 'mongoose';
import { DB_NAME_PATTERN, DEFAULT_POOLS_DB_NAME } from '../config/databases.js';

const name = process.env.POOLS_DB_NAME ?? DEFAULT_POOLS_DB_NAME;
if (!DB_NAME_PATTERN.test(name)) {
  throw new Error('POOLS_DB_NAME may only contain letters, digits, "_" and "-" (max 60 characters)');
}

// A second database reached through the same connection (and pool) as the main one, so it needs no
// extra credentials or connection string. It opens when mongoose.connect() succeeds.
export const poolsDb = mongoose.connection.useDb(name, { useCache: true });
