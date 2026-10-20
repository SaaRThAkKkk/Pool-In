import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp, type AppConfig } from '../src/app.js';

export const testConfig: AppConfig = {
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-secret-test-secret-test-secret',
  JWT_EXPIRES_DAYS: 7,
  NODE_ENV: 'test',
};

export function makeApp(opts?: { rateLimitEnabled?: boolean }) {
  return createApp(testConfig, opts);
}

let mongod: MongoMemoryServer | undefined;

export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Unique indexes must exist before concurrency tests rely on them.
  await mongoose.syncIndexes();
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function clearDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}
