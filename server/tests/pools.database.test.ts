import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { assertSeparateDatabases, DEFAULT_POOLS_DB_NAME } from '../src/config/databases.js';
import { loadEnv } from '../src/config/env.js';
import { Ride } from '../src/models/Ride.js';
import { User } from '../src/models/User.js';
import { poolsDb } from '../src/models/poolsDb.js';
import { migrateRidesToPoolsDb } from '../src/scripts/migrateRides.js';
import { clearDb, makeApp, startTestDb, stopTestDb } from './helpers.js';

const app = makeApp();

async function signUp(email = 'owner@example.com', phone = '9876543210') {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'Owner One', email, phone, password: 'Passw0rdOK' });
  return agent;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

const ride = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
  destination: { label: 'Kempegowda Airport', coordinates: { lat: 13.1986, lng: 77.7066 } },
  departureAt: hoursFromNow(48),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: false,
  ...over,
});

const mainDbName = () => mongoose.connection.name;

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('pools live in their own database', () => {
  it('uses a different database from users, named pool-in-pools by default', () => {
    expect(poolsDb.name).toBe(DEFAULT_POOLS_DB_NAME);
    expect(poolsDb.name).not.toBe(mainDbName());
    expect(Ride.db.name).toBe(poolsDb.name);
    expect(User.db.name).toBe(mainDbName());
  });

  it('writes a new pool to the pools database and nothing to the main one', async () => {
    const owner = await signUp();
    const res = await owner.post('/api/rides').send(ride());
    expect(res.status).toBe(201);

    expect(await poolsDb.collection('rides').countDocuments()).toBe(1);
    expect(await mongoose.connection.collection('rides').countDocuments()).toBe(0);
    // Accounts stay in the main database.
    expect(await mongoose.connection.collection('users').countDocuments()).toBe(1);
    expect(await poolsDb.collection('users').countDocuments()).toBe(0);
  });

  it('keeps serving the owner\'s own pools from the pools database', async () => {
    const owner = await signUp();
    await owner.post('/api/rides').send(ride());
    const res = await owner.get('/api/rides/mine');
    expect(res.body.data.rides).toHaveLength(1);
  });

  it('refuses to start if both databases would be the same one, ignoring case', () => {
    expect(() => assertSeparateDatabases('pool-in', 'Pool-In')).toThrow(/must be a different database/);
    expect(() => assertSeparateDatabases('pool-in', 'pool-in-pools')).not.toThrow();
  });
});

describe('POOLS_DB_NAME setting', () => {
  const base = { MONGODB_URI: 'mongodb://x/y', JWT_SECRET: 'x'.repeat(32) };

  it('defaults to pool-in-pools', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).POOLS_DB_NAME).toBe('pool-in-pools');
  });

  it('accepts a custom name and rejects unsafe ones', () => {
    expect(loadEnv({ ...base, POOLS_DB_NAME: 'my_pools-2' } as NodeJS.ProcessEnv).POOLS_DB_NAME).toBe('my_pools-2');
    for (const bad of ['has space', 'a/b', 'dots.in.name', '', 'x'.repeat(61)]) {
      expect(() => loadEnv({ ...base, POOLS_DB_NAME: bad } as NodeJS.ProcessEnv)).toThrow(/POOLS_DB_NAME/);
    }
  });
});

describe('search-ready storage', () => {
  it('has the indexes that pool search filters will use', async () => {
    const indexes = await poolsDb.collection('rides').indexes();
    const keys = indexes.map((i) => JSON.stringify(i.key));

    expect(keys).toContain(JSON.stringify({ rideStatus: 1, departureAt: 1 }));
    expect(keys).toContain(JSON.stringify({ rideStatus: 1, availableSeats: 1, askingPrice: 1 }));
    expect(keys).toContain(JSON.stringify({ rideStatus: 1, 'vehicle.category': 1, departureAt: 1 }));
    expect(keys).toContain(JSON.stringify({ originPoint: '2dsphere' }));
    expect(keys).toContain(JSON.stringify({ destinationPoint: '2dsphere' }));
  });

  it('stores GeoJSON points for places with coordinates, and none otherwise', async () => {
    const owner = await signUp();
    const withCoords = await owner.post('/api/rides').send(ride());
    const without = await owner.post('/api/rides').send(
      ride({ origin: { label: 'Typed place only' }, destination: { label: 'Another typed place' } }),
    );
    expect(without.status).toBe(201);

    const a = await poolsDb.collection('rides').findOne({ _id: new mongoose.Types.ObjectId(withCoords.body.data.ride.id) });
    expect(a!.originPoint).toEqual({ type: 'Point', coordinates: [77.6408, 12.9784] });
    expect(a!.destinationPoint).toEqual({ type: 'Point', coordinates: [77.7066, 13.1986] });

    const b = await poolsDb.collection('rides').findOne({ _id: new mongoose.Types.ObjectId(without.body.data.ride.id) });
    expect(b).not.toBeNull();
    expect(b!.originPoint).toBeUndefined();
  });

  it('can narrow stored pools by every filter at once: time, seats, price, vehicle, distance', async () => {
    const owner = await signUp();
    const make = (over: Record<string, unknown>) => owner.post('/api/rides').send(ride(over));

    await make({ destination: { label: 'Match', coordinates: { lat: 13.1, lng: 77.7 } }, departureAt: hoursFromNow(30), seats: 3, askingPrice: 200 });
    await make({ destination: { label: 'Too expensive', coordinates: { lat: 13.1, lng: 77.7 } }, departureAt: hoursFromNow(30), askingPrice: 900 });
    await make({ destination: { label: 'Too few seats', coordinates: { lat: 13.1, lng: 77.7 } }, departureAt: hoursFromNow(30), seats: 1, askingPrice: 200 });
    await make({ destination: { label: 'Wrong day', coordinates: { lat: 13.1, lng: 77.7 } }, departureAt: hoursFromNow(200), askingPrice: 200 });
    await make({ destination: { label: 'Wrong vehicle', coordinates: { lat: 13.1, lng: 77.7 } }, departureAt: hoursFromNow(30), askingPrice: 200, vehicle: { category: 'SUV', make: 'Toyota', model: 'Innova' } });
    await make({ origin: { label: 'Mumbai start', coordinates: MUMBAI }, destination: { label: 'Far away', coordinates: { lat: 19.2, lng: 72.9 } }, departureAt: hoursFromNow(30), askingPrice: 200 });
    await make({ origin: { label: 'No coordinates' }, destination: { label: 'Nowhere special' }, departureAt: hoursFromNow(30), askingPrice: 200 });

    const found = await Ride.find({
      rideStatus: 'OPEN',
      departureAt: { $gte: new Date(hoursFromNow(24)), $lte: new Date(hoursFromNow(48)) },
      availableSeats: { $gte: 2 },
      askingPrice: { $lte: 300 },
      'vehicle.category': 'SEDAN',
      originPoint: { $near: { $geometry: { type: 'Point', coordinates: [BENGALURU.lng, BENGALURU.lat] }, $maxDistance: 10_000 } },
    });

    expect(found.map((r) => r.destination.label)).toEqual(['Match']);
  });

  it('finds pools heading to a destination area, nearest first', async () => {
    const owner = await signUp();
    await owner.post('/api/rides').send(ride({ destination: { label: 'Airport', coordinates: { lat: 13.1986, lng: 77.7066 } } }));
    await owner.post('/api/rides').send(ride({ destination: { label: 'Hebbal', coordinates: { lat: 13.0358, lng: 77.597 } }, departureAt: hoursFromNow(60) }));

    const nearHebbal = await Ride.find({
      destinationPoint: { $near: { $geometry: { type: 'Point', coordinates: [77.6, 13.04] }, $maxDistance: 30_000 } },
    });
    expect(nearHebbal.map((r) => r.destination.label)).toEqual(['Hebbal', 'Airport']);
  });
});

describe('migrateRidesToPoolsDb', () => {
  const oldRide = (id: string, over: object = {}) => ({
    _id: new mongoose.Types.ObjectId(id),
    rideType: 'OWNER_VEHICLE',
    ownerUserId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    origin: { label: 'Old start', coordinates: { lat: 12.9784, lng: 77.6408 } },
    destination: { label: 'Old destination' },
    departureAt: new Date(Date.now() + 86_400_000),
    vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
    passengerCapacity: 3,
    availableSeats: 3,
    currentPassengerCount: 0,
    pricingMode: 'FIXED',
    askingPrice: 100,
    currency: 'INR',
    priceBasis: 'PER_PASSENGER',
    rideStatus: 'OPEN',
    dedupeKey: `old|${id}`,
    ...over,
  });

  const source = () => mongoose.connection.db!;
  const target = () => poolsDb.db!;

  it('copies old pools across, adds search points, and leaves the originals untouched', async () => {
    await source().collection('rides').insertMany([
      oldRide('aaaaaaaaaaaaaaaaaaaaaaaa'),
      oldRide('bbbbbbbbbbbbbbbbbbbbbbbb', { origin: { label: 'Typed only' } }),
    ]);

    const res = await migrateRidesToPoolsDb(source(), target());
    expect(res).toEqual({ found: 2, inserted: 2, alreadyThere: 0 });

    const copied = await target().collection('rides').find().sort({ _id: 1 }).toArray();
    expect(copied.map((d) => d._id.toString())).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb']);
    expect(copied[0]!.originPoint).toEqual({ type: 'Point', coordinates: [77.6408, 12.9784] });
    expect(copied[1]!.originPoint).toBeUndefined();
    expect(copied[0]!.origin.label).toBe('Old start');

    expect(await source().collection('rides').countDocuments()).toBe(2);
  });

  it('can be run again without creating duplicates', async () => {
    await source().collection('rides').insertOne(oldRide('aaaaaaaaaaaaaaaaaaaaaaaa'));

    await migrateRidesToPoolsDb(source(), target());
    const again = await migrateRidesToPoolsDb(source(), target());

    expect(again).toEqual({ found: 1, inserted: 0, alreadyThere: 1 });
    expect(await target().collection('rides').countDocuments()).toBe(1);
  });

  it('handles an empty source', async () => {
    expect(await migrateRidesToPoolsDb(source(), target())).toEqual({ found: 0, inserted: 0, alreadyThere: 0 });
  });

  it('migrated pools are visible to the app', async () => {
    const owner = await signUp();
    const ownerId = (await owner.get('/api/auth/me')).body.data.user.id;
    await source().collection('rides').insertOne(oldRide('aaaaaaaaaaaaaaaaaaaaaaaa', { ownerUserId: new mongoose.Types.ObjectId(ownerId) }));

    await migrateRidesToPoolsDb(source(), target());
    const res = await owner.get('/api/rides/mine');
    expect(res.body.data.rides.map((r: { id: string }) => r.id)).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa']);
  });
});
