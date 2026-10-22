import mongoose from 'mongoose';
import { poolsDb } from '../models/poolsDb.js';
import { logger } from '../utils/logger.js';
import { assertSeparateDatabases } from './databases.js';

export async function connectDb(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  assertSeparateDatabases(mongoose.connection.name, poolsDb.name);
  logger.info({ main: mongoose.connection.name, pools: poolsDb.name }, 'MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
