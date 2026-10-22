import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp, type AppConfig } from '../src/app.js';
import type { SmsProvider } from '../src/services/sms/index.js';
import type { MapsProvider, Place, RouteResult } from '../src/services/maps/types.js';
import type { LatLng } from '../src/utils/geo.js';

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

// Scripted stand-in for the map services, so tests never touch the network.
export class FakeMaps implements MapsProvider {
  searches: { query: string; bias?: LatLng }[] = [];
  routeCalls: { from: LatLng; to: LatLng }[] = [];
  places: Place[] = [
    { id: 'N1', title: 'Indiranagar', subtitle: 'Bengaluru, Karnataka', label: 'Indiranagar, Bengaluru, Karnataka', lat: 12.9784, lng: 77.6408 },
  ];
  route: RouteResult = {
    distanceMeters: 35_214.6,
    durationSeconds: 2140.4,
    path: [
      [12.9784, 77.6408],
      [13.1986, 77.7064],
    ],
  };
  error?: Error;

  async searchPlaces(query: string, bias?: LatLng) {
    this.searches.push({ query, bias });
    if (this.error) throw this.error;
    return this.places;
  }

  async getRoute(from: LatLng, to: LatLng) {
    this.routeCalls.push({ from, to });
    if (this.error) throw this.error;
    return this.route;
  }
}

export function makeApp(
  opts: { rateLimitEnabled?: boolean; sms?: SmsProvider; maps?: MapsProvider; config?: Partial<AppConfig> } = {},
) {
  return createApp(
    { ...testConfig, ...opts.config },
    {
      sms: opts.sms ?? new CapturingSms(),
      maps: opts.maps ?? new FakeMaps(),
      rateLimitEnabled: opts.rateLimitEnabled,
    },
  );
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
