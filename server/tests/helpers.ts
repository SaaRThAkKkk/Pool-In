import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp, type AppConfig } from '../src/app.js';
import { poolsDb } from '../src/models/poolsDb.js';
import type { SmsProvider } from '../src/services/sms/index.js';
import type { MapsProvider, Place, RouteResult } from '../src/services/maps/types.js';
import { distanceMetres, type LatLng } from '../src/utils/geo.js';
import type { FindOptions, PoolMatcher } from '../src/services/matching/matcher.js';
import type {
  OwnerMatch,
  OwnerPoolCandidate,
  OwnerSearchResult,
  PassengerMatch,
  PassengerRequest,
  PassengerSearchResult,
} from '../src/services/matching/types.js';
import type { SearchNotifier } from '../src/services/realtime/notifier.js';

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

  itineraryCalls: LatLng[][] = [];
  async getItinerary(points: LatLng[]) {
    this.itineraryCalls.push(points);
    if (this.error) throw this.error;
    const legs = points.slice(1).map((p, i) => ({
      distanceMeters: distanceMetres(points[i]!, p),
      durationSeconds: distanceMetres(points[i]!, p) / 10,
    }));
    return {
      distanceMeters: legs.reduce((s, l) => s + l.distanceMeters, 0),
      durationSeconds: legs.reduce((s, l) => s + l.durationSeconds, 0),
      legs,
    };
  }
}

// Records what it was asked, and returns whatever the test scripts. Never touches the database or routing.
export class FakeMatcher implements PoolMatcher {
  ownerCalls: { request: PassengerRequest; opts?: FindOptions }[] = [];
  peerCalls: PassengerRequest[] = [];
  poolChecks: { request: PassengerRequest; poolId: string }[] = [];

  /** What the owner search returns. Tests change this to simulate pools appearing. */
  ownerMatches: OwnerMatch[] = [];
  ownerStatus: 'OK' | 'DEGRADED' = 'OK';
  groups: PassengerMatch[] = [];
  /** What checking one specific new pool returns. */
  poolResult: OwnerMatch | null | 'ROUTING_ERROR' = null;

  async findOwnerMatches(request: PassengerRequest, opts?: FindOptions): Promise<OwnerSearchResult> {
    this.ownerCalls.push({ request, opts });
    return {
      status: this.ownerStatus,
      sections: ['CAR_OWNER', 'CAB'],
      matches: this.ownerMatches,
      checked: this.ownerMatches.length,
      routingFailures: this.ownerStatus === 'DEGRADED' ? 1 : 0,
      rejected: {},
    };
  }

  async findPassengerMatches(request: PassengerRequest): Promise<PassengerSearchResult> {
    this.peerCalls.push(request);
    return { status: 'OK', matches: this.groups, checked: this.groups.length, routingFailures: 0, rejected: {} };
  }

  async evaluatePool(request: PassengerRequest, pool: OwnerPoolCandidate) {
    this.poolChecks.push({ request, poolId: pool.id });
    return this.poolResult;
  }
}

// Records what the server pushed to users in real time.
export class RecordingNotifier implements SearchNotifier {
  sent: { userId: string; event: string; payload: unknown }[] = [];
  notifyUser(userId: string, event: string, payload: unknown) {
    this.sent.push({ userId, event, payload });
  }
}

export function fakeOwnerMatch(poolId: string, score = 80, over: Partial<OwnerMatch> = {}): OwnerMatch {
  return {
    section: 'CAR_OWNER',
    poolId,
    score,
    breakdown: [],
    reasons: ['Pickup is 1 km from you by road, within your 2 km limit.'],
    route: { from: 'Indiranagar', to: 'Airport' },
    vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
    seatsAvailable: 3,
    fare: { amount: 250, negotiable: false },
    pickup: { lat: 12.99, lng: 77.65, roadKmFromRequestedPickup: 1, eta: '2030-06-01T08:00:00.000Z' },
    dropoff: { lat: 13.18, lng: 77.7, roadKmToDestination: 0.5, eta: '2030-06-01T08:40:00.000Z' },
    driverDetourKm: 0.2,
    rideKm: 20,
    driverDepartsAt: '2030-06-01T07:50:00.000Z',
    evaluatedAt: '2030-06-01T06:00:00.000Z',
    ...over,
  };
}

export function makeApp(
  opts: {
    rateLimitEnabled?: boolean;
    sms?: SmsProvider;
    maps?: MapsProvider;
    matcher?: PoolMatcher;
    notifier?: SearchNotifier;
    config?: Partial<AppConfig>;
  } = {},
) {
  return createApp(
    { ...testConfig, ...opts.config },
    {
      sms: opts.sms ?? new CapturingSms(),
      maps: opts.maps ?? new FakeMaps(),
      matcher: opts.matcher ?? new FakeMatcher(),
      notifier: opts.notifier ?? new RecordingNotifier(),
      rateLimitEnabled: opts.rateLimitEnabled,
    },
  );
}

let mongod: MongoMemoryServer | undefined;

export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Unique indexes must exist before concurrency tests rely on them (users and pools are separate databases).
  await mongoose.syncIndexes();
  await poolsDb.syncIndexes();
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function clearDb() {
  const collections = [...Object.values(mongoose.connection.collections), ...Object.values(poolsDb.collections)];
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
