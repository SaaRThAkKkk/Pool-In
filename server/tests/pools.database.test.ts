import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { assertSeparateDatabases, DEFAULT_POOLS_DB_NAME } from '../src/config/databases.js';
import { loadEnv } from '../src/config/env.js';
import { CAB_COLLECTION, CAR_OWNER_COLLECTION } from '../src/config/pools.js';
import { CabPool } from '../src/models/CabPool.js';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { User } from '../src/models/User.js';
import { poolsDb } from '../src/models/poolsDb.js';
import { clearDb, makeApp, startTestDb, stopTestDb } from './helpers.js';

const app = makeApp();

async function signUp(email = 'rider@example.com', phone = '9876543210') {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name: 'Rider One', email, phone, password: 'Passw0rdOK' });
  return agent;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

const base = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
  destination: { label: 'Kempegowda Airport', coordinates: { lat: 13.1986, lng: 77.7066 } },
  arriveBy: hoursFromNow(48),
  luggage: { large: 0, medium: 0, cabin: 1, backpack: 0, oversized: 0 },
  ...over,
});
const owner = (over: Record<string, unknown> = {}) => ({
  mode: 'OWN_VEHICLE',
  ...base(),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: false,
  ...over,
});
const cab = (over: Record<string, unknown> = {}) => ({ mode: 'POOL_CAB', ...base(), people: 2, ...over });

const mainDbName = () => mongoose.connection.name;

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('pools live in their own database, split into two sections', () => {
  it('uses a different database from users, named pool-in-pools by default', () => {
    expect(poolsDb.name).toBe(DEFAULT_POOLS_DB_NAME);
    expect(poolsDb.name).not.toBe(mainDbName());
    expect(CarOwnerPool.db.name).toBe(poolsDb.name);
    expect(CabPool.db.name).toBe(poolsDb.name);
    expect(User.db.name).toBe(mainDbName());
  });

  it('names the two sections as separate collections', () => {
    expect(CarOwnerPool.collection.collectionName).toBe(CAR_OWNER_COLLECTION);
    expect(CabPool.collection.collectionName).toBe(CAB_COLLECTION);
    expect(CAR_OWNER_COLLECTION).not.toBe(CAB_COLLECTION);
  });

  it('writes an own-vehicle pool to the car-owner section only', async () => {
    const user = await signUp();
    expect((await user.post('/api/pools').send(owner())).status).toBe(201);

    expect(await poolsDb.collection(CAR_OWNER_COLLECTION).countDocuments()).toBe(1);
    expect(await poolsDb.collection(CAB_COLLECTION).countDocuments()).toBe(0);
  });

  it('writes a cab request to the cab section only', async () => {
    const user = await signUp();
    expect((await user.post('/api/pools').send(cab())).status).toBe(201);

    expect(await poolsDb.collection(CAB_COLLECTION).countDocuments()).toBe(1);
    expect(await poolsDb.collection(CAR_OWNER_COLLECTION).countDocuments()).toBe(0);
  });

  it('keeps pools out of the main database, and accounts out of the pools database', async () => {
    const user = await signUp();
    await user.post('/api/pools').send(owner());
    await user.post('/api/pools').send(cab());

    for (const name of [CAR_OWNER_COLLECTION, CAB_COLLECTION, 'rides']) {
      expect(await mongoose.connection.collection(name).countDocuments()).toBe(0);
    }
    expect(await mongoose.connection.collection('users').countDocuments()).toBe(1);
    expect(await poolsDb.collection('users').countDocuments()).toBe(0);
  });

  it('refuses to start if both databases would be the same one, ignoring case', () => {
    expect(() => assertSeparateDatabases('pool-in', 'Pool-In')).toThrow(/must be a different database/);
    expect(() => assertSeparateDatabases('pool-in', 'pool-in-pools')).not.toThrow();
  });
});

describe('POOLS_DB_NAME setting', () => {
  const env = { MONGODB_URI: 'mongodb://x/y', JWT_SECRET: 'x'.repeat(32) };

  it('defaults to pool-in-pools', () => {
    expect(loadEnv(env as NodeJS.ProcessEnv).POOLS_DB_NAME).toBe('pool-in-pools');
  });

  it('accepts a custom name and rejects unsafe ones', () => {
    expect(loadEnv({ ...env, POOLS_DB_NAME: 'my_pools-2' } as NodeJS.ProcessEnv).POOLS_DB_NAME).toBe('my_pools-2');
    for (const bad of ['has space', 'a/b', 'dots.in.name', '', 'x'.repeat(61)]) {
      expect(() => loadEnv({ ...env, POOLS_DB_NAME: bad } as NodeJS.ProcessEnv)).toThrow(/POOLS_DB_NAME/);
    }
  });
});

describe('search-ready storage', () => {
  const keysOf = async (collection: string) =>
    (await poolsDb.collection(collection).indexes()).map((i) => JSON.stringify(i.key));

  it('indexes the car-owner section for time, seats, price, vehicle and distance filters', async () => {
    const keys = await keysOf(CAR_OWNER_COLLECTION);
    expect(keys).toContain(JSON.stringify({ status: 1, arriveBy: 1 }));
    expect(keys).toContain(JSON.stringify({ status: 1, availableSeats: 1, askingPrice: 1 }));
    expect(keys).toContain(JSON.stringify({ status: 1, 'vehicle.category': 1, arriveBy: 1 }));
    expect(keys).toContain(JSON.stringify({ originPoint: '2dsphere' }));
    expect(keys).toContain(JSON.stringify({ destinationPoint: '2dsphere' }));
  });

  it('indexes the cab section for time and distance filters', async () => {
    const keys = await keysOf(CAB_COLLECTION);
    expect(keys).toContain(JSON.stringify({ status: 1, arriveBy: 1 }));
    expect(keys).toContain(JSON.stringify({ originPoint: '2dsphere' }));
    expect(keys).toContain(JSON.stringify({ destinationPoint: '2dsphere' }));
  });

  it('stores GeoJSON points for places with coordinates, in both sections, and none otherwise', async () => {
    const user = await signUp();
    const o = await user.post('/api/pools').send(owner());
    const c = await user.post('/api/pools').send(cab());
    const typed = await user.post('/api/pools').send(
      cab({ origin: { label: 'Typed place only' }, destination: { label: 'Another typed place' } }),
    );
    expect(typed.status).toBe(201);

    const id = (res: { body: { data: { pool: { id: string } } } }) => new mongoose.Types.ObjectId(res.body.data.pool.id);
    const a = await poolsDb.collection(CAR_OWNER_COLLECTION).findOne({ _id: id(o) });
    const b = await poolsDb.collection(CAB_COLLECTION).findOne({ _id: id(c) });
    const t = await poolsDb.collection(CAB_COLLECTION).findOne({ _id: id(typed) });

    for (const doc of [a, b]) {
      expect(doc!.originPoint).toEqual({ type: 'Point', coordinates: [77.6408, 12.9784] });
      expect(doc!.destinationPoint).toEqual({ type: 'Point', coordinates: [77.7066, 13.1986] });
    }
    expect(t).not.toBeNull();
    expect(t!.originPoint).toBeUndefined();
  });

  it('keeps luggage and the arrive-by time on every pool, in both sections', async () => {
    const user = await signUp();
    const o = await user.post('/api/pools').send(owner({ luggage: { large: 2, medium: 1, cabin: 0, backpack: 3, oversized: 1 } }));
    const c = await user.post('/api/pools').send(cab({ luggage: { large: 1, medium: 0, cabin: 0, backpack: 0, oversized: 0 } }));

    const a = await CarOwnerPool.findById(o.body.data.pool.id);
    const b = await CabPool.findById(c.body.data.pool.id);
    expect(a!.luggage).toMatchObject({ large: 2, medium: 1, backpack: 3, oversized: 1 });
    expect(b!.luggage).toMatchObject({ large: 1 });
    expect(a!.arriveBy).toBeInstanceOf(Date);
    expect(b!.arriveBy).toBeInstanceOf(Date);
  });

  it('can narrow car-owner pools by every filter at once: time, seats, price, vehicle, distance', async () => {
    const user = await signUp();
    const make = (over: Record<string, unknown>) => user.post('/api/pools').send(owner(over));
    const near = { label: 'x', coordinates: { lat: 13.1, lng: 77.7 } };

    await make({ destination: { ...near, label: 'Match' }, arriveBy: hoursFromNow(30), seats: 3, askingPrice: 200 });
    await make({ destination: { ...near, label: 'Too expensive' }, arriveBy: hoursFromNow(30), askingPrice: 900 });
    await make({ destination: { ...near, label: 'Too few seats' }, arriveBy: hoursFromNow(30), seats: 1, askingPrice: 200 });
    await make({ destination: { ...near, label: 'Wrong day' }, arriveBy: hoursFromNow(200), askingPrice: 200 });
    await make({ destination: { ...near, label: 'Wrong vehicle' }, arriveBy: hoursFromNow(30), askingPrice: 200, vehicle: { category: 'SUV', make: 'Toyota', model: 'Innova' } });
    await make({ origin: { label: 'Mumbai start', coordinates: MUMBAI }, destination: { label: 'Far away', coordinates: { lat: 19.2, lng: 72.9 } }, arriveBy: hoursFromNow(30), askingPrice: 200 });
    await make({ origin: { label: 'No coordinates' }, destination: { label: 'Nowhere special' }, arriveBy: hoursFromNow(30), askingPrice: 200 });

    const found = await CarOwnerPool.find({
      status: 'OPEN',
      arriveBy: { $gte: new Date(hoursFromNow(24)), $lte: new Date(hoursFromNow(48)) },
      availableSeats: { $gte: 2 },
      askingPrice: { $lte: 300 },
      'vehicle.category': 'SEDAN',
      originPoint: { $near: { $geometry: { type: 'Point', coordinates: [BENGALURU.lng, BENGALURU.lat] }, $maxDistance: 10_000 } },
    });
    expect(found.map((p) => p.destination.label)).toEqual(['Match']);
  });

  it('one query shape searches BOTH sections (what matching will need)', async () => {
    const owners = await signUp('owner@example.com', '9876543210');
    const riders = await signUp('riders@example.com', '9123456780');
    await owners.post('/api/pools').send(owner({ destination: { label: 'Owner trip', coordinates: { lat: 13.1, lng: 77.7 } } }));
    await riders.post('/api/pools').send(cab({ destination: { label: 'Cab trip', coordinates: { lat: 13.11, lng: 77.71 } } }));
    await riders.post('/api/pools').send(
      cab({ origin: { label: 'Mumbai', coordinates: MUMBAI }, destination: { label: 'Faraway cab trip', coordinates: { lat: 19.2, lng: 72.9 } } }),
    );

    const query = {
      status: 'OPEN',
      arriveBy: { $gte: new Date(hoursFromNow(24)), $lte: new Date(hoursFromNow(72)) },
      originPoint: {
        $near: { $geometry: { type: 'Point' as const, coordinates: [BENGALURU.lng, BENGALURU.lat] }, $maxDistance: 10_000 },
      },
    };
    // The two sections have different status enums, so the shared filter is passed untyped.
    const [fromOwners, fromCabs] = await Promise.all([CarOwnerPool.find(query as never), CabPool.find(query as never)]);

    expect(fromOwners.map((p) => p.destination.label)).toEqual(['Owner trip']);
    expect(fromCabs.map((p) => p.destination.label)).toEqual(['Cab trip']);
  });
});
