import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp, type AppConfig } from '../src/app.js';
import type { SmsProvider } from '../src/services/sms/index.js';

export const testConfig: AppConfig = {
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-secret-test-secret-test-secret',
  JWT_EXPIRES_DAYS: 7,
  NODE_ENV: 'test',
};

// Captures OTPs instead of sending SMS.
export class CapturingSms implements SmsProvider {
  sent: { phone: string; code: string }[] = [];
  failNext = false;

  async sendOtp(phone: string, code: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    this.sent.push({ phone, code });
  }

  get lastCode() {
    return this.sent.at(-1)?.code;
  }
}

export function makeApp(opts: { rateLimitEnabled?: boolean; sms?: SmsProvider } = {}) {
  return createApp(testConfig, { sms: opts.sms ?? new CapturingSms(), rateLimitEnabled: opts.rateLimitEnabled });
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
