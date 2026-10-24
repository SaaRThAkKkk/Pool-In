import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { reserveSeats } from '../src/services/pools/seatReservation.js';
import { clearDb, startTestDb, stopTestDb } from './helpers.js';

let n = 0;
async function seedPool(over: Record<string, unknown> = {}) {
  n += 1;
  return CarOwnerPool.create({
    userId: new Types.ObjectId(),
    origin: { label: 'Start', coordinates: { lat: 12.97, lng: 77.64 } },
    destination: { label: 'End', coordinates: { lat: 13.19, lng: 77.7 } },
    arriveBy: new Date(Date.now() + 3 * 3_600_000),
    luggage: { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 },
    vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
    seatsOffered: 3,
    availableSeats: 3,
    pricingMode: 'FIXED',
    askingPrice: 200,
    luggageSpaceUnits: 4,
    status: 'OPEN',
    dedupeKey: `seat-${n}`,
    ...over,
  });
}

const reload = (id: string) => CarOwnerPool.findById(id).then((p) => p!);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('reserveSeats: the server-side check when a join request is accepted', () => {
  it('takes the seats and the luggage space, and updates the counts together', async () => {
    const pool = await seedPool();
    const updated = await reserveSeats(pool.id, { seats: 2, luggageUnits: 3 });

    expect(updated.availableSeats).toBe(1);
    expect(updated.currentPassengerCount).toBe(2);
    expect(updated.luggageUsedUnits).toBe(3);
    expect(updated.status).toBe('PARTIALLY_FILLED');
  });

  it('marks the pool full when the last seat goes', async () => {
    const pool = await seedPool({ availableSeats: 1, currentPassengerCount: 2, status: 'PARTIALLY_FILLED' });
    const updated = await reserveSeats(pool.id, { seats: 1, luggageUnits: 0 });
    expect(updated.availableSeats).toBe(0);
    expect(updated.status).toBe('FULL');
  });

  it('refuses more seats than are left, and changes nothing', async () => {
    const pool = await seedPool({ availableSeats: 2 });
    await expect(reserveSeats(pool.id, { seats: 3, luggageUnits: 0 })).rejects.toMatchObject({ status: 409, code: 'SEATS_UNAVAILABLE' });
    expect((await reload(pool.id)).availableSeats).toBe(2);
  });

  it('refuses luggage that no longer fits, and changes nothing', async () => {
    const pool = await seedPool({ luggageSpaceUnits: 4, luggageUsedUnits: 3 });
    await expect(reserveSeats(pool.id, { seats: 1, luggageUnits: 2 })).rejects.toMatchObject({ code: 'SEATS_UNAVAILABLE' });
    const after = await reload(pool.id);
    expect(after.availableSeats).toBe(3);
    expect(after.luggageUsedUnits).toBe(3);
  });

  it('accepts luggage that fills the space exactly', async () => {
    const pool = await seedPool({ luggageSpaceUnits: 4, luggageUsedUnits: 3 });
    const updated = await reserveSeats(pool.id, { seats: 1, luggageUnits: 1 });
    expect(updated.luggageUsedUnits).toBe(4);
  });

  it.each(['FULL', 'CANCELLED', 'COMPLETED', 'EXPIRED', 'IN_PROGRESS', 'CONFIRMED'])(
    'refuses a pool that is %s, however many seats it shows',
    async (status) => {
      const pool = await seedPool({ status });
      await expect(reserveSeats(pool.id, { seats: 1, luggageUnits: 0 })).rejects.toMatchObject({ code: 'SEATS_UNAVAILABLE' });
      expect((await reload(pool.id)).availableSeats).toBe(3);
    },
  );

  it('says a pool that does not exist is not found', async () => {
    await expect(reserveSeats(new Types.ObjectId().toString(), { seats: 1, luggageUnits: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it('uses the vehicle default for luggage space when the owner declared none', async () => {
    const pool = await seedPool({ luggageSpaceUnits: undefined, luggage: { large: 1, medium: 0, cabin: 0, backpack: 0, oversized: 0 } });
    // sedan default 4, less the owner's own large suitcase (2) = 2 units for riders
    await reserveSeats(pool.id, { seats: 1, luggageUnits: 2 });
    await expect(reserveSeats(pool.id, { seats: 1, luggageUnits: 1 })).rejects.toMatchObject({ code: 'SEATS_UNAVAILABLE' });
  });
});

describe('reserveSeats: simultaneous requests can never take more than there is', () => {
  it('lets exactly one of many racing requests have the last seat', async () => {
    const pool = await seedPool({ availableSeats: 1, currentPassengerCount: 2, status: 'PARTIALLY_FILLED' });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveSeats(pool.id, { seats: 1, luggageUnits: 0 })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(11);
    const after = await reload(pool.id);
    expect(after.availableSeats).toBe(0);
    expect(after.currentPassengerCount).toBe(3);
    expect(after.status).toBe('FULL');
  });

  it('hands out exactly the seats available across many requests, and never goes negative', async () => {
    const pool = await seedPool({ availableSeats: 3, seatsOffered: 3 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveSeats(pool.id, { seats: 1, luggageUnits: 0 })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const after = await reload(pool.id);
    expect(after.availableSeats).toBe(0);
    expect(after.currentPassengerCount).toBe(3);
  });

  it('mixes party sizes without overbooking: 2 + 2 cannot both fit in 3 seats', async () => {
    const pool = await seedPool({ availableSeats: 3 });
    const results = await Promise.allSettled([
      reserveSeats(pool.id, { seats: 2, luggageUnits: 0 }),
      reserveSeats(pool.id, { seats: 2, luggageUnits: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await reload(pool.id)).availableSeats).toBe(1);
  });

  it('cannot exceed the luggage space under pressure either', async () => {
    const pool = await seedPool({ availableSeats: 3, luggageSpaceUnits: 4 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => reserveSeats(pool.id, { seats: 1, luggageUnits: 2 })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); // 2 + 2 = 4 units
    expect((await reload(pool.id)).luggageUsedUnits).toBe(4);
  });
});
