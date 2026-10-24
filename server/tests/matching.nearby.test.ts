import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { MATCHING } from '../src/config/matching.js';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { distanceMetres, type LatLng } from '../src/utils/geo.js';
import { MongoCandidateRepository } from '../src/services/matching/candidateRepository.js';
import { CarpoolMatcher } from '../src/services/matching/matcher.js';
import { explainMiss, gapsToRoute, toNearbyPool } from '../src/services/matching/nearbyPools.js';
import { clearDb, startTestDb, stopTestDb } from './helpers.js';
import { A, B, HOUR, NOW, RoadMaps, makePool, makeRequest, pointNear, straightLine } from './matchingHelpers.js';

const gaps = { startGapKm: 4, endGapKm: 0.5 };

describe('explaining why a nearby pool does not fit', () => {
  const pool = makePool();
  const request = makeRequest();

  it('pickup too far: says how far its route passes, and the limit the passenger set', () => {
    const [why] = explainMiss(request, pool, 'PICKUP_TOO_FAR', gaps);
    expect(why).toContain('about 4 km from your start');
    expect(why).toContain(`${request.maxPickupTravelKm} km`);
  });

  it('pickup too far by road, though close in a straight line', () => {
    const [why] = explainMiss(request, pool, 'PICKUP_TOO_FAR', { startGapKm: 1, endGapKm: 0 });
    expect(why).toMatch(/further by road/);
  });

  it('drop-off too far, with and without a drop-off limit', () => {
    expect(explainMiss(request, pool, 'DROPOFF_TOO_FAR', gaps)[0]).toContain(`${request.maxDropoffTravelKm} km you accept`);
    expect(explainMiss({ ...request, maxDropoffTravelKm: undefined }, pool, 'DROPOFF_TOO_FAR', gaps)[0]).toMatch(/too far from your destination/);
  });

  it('time: says by how many minutes and which way', () => {
    const later = makePool({ arriveBy: new Date(request.arriveBy.getTime() + 90 * 60_000) });
    expect(explainMiss(request, later, 'TIME', gaps)[0]).toMatch(/about 90 min after/);
    const earlier = makePool({ arriveBy: new Date(request.arriveBy.getTime() - 120 * 60_000) });
    expect(explainMiss(request, earlier, 'TIME', gaps)[0]).toMatch(/about 120 min before/);
  });

  it('seats, luggage, budget, detour, direction', () => {
    expect(explainMiss({ ...request, people: 3 }, makePool({ availableSeats: 1 }), 'SEATS', gaps)[0]).toBe('Only 1 seat free, and you need 3.');
    expect(explainMiss(request, pool, 'LUGGAGE', gaps)[0]).toMatch(/luggage/);
    expect(explainMiss({ ...request, maxBudget: 100 }, pool, 'BUDGET', gaps)[0]).toContain('₹250');
    expect(explainMiss(request, pool, 'DETOUR', gaps)[0]).toContain('5 km extra');
    expect(explainMiss(request, pool, 'ROUTE_ORDER', gaps)[0]).toMatch(/other way/);
    expect(explainMiss(request, pool, 'ROUTING_ERROR', gaps)[0]).toMatch(/couldn't check/);
  });

  it('measures how far the route passes from the start and the destination', () => {
    const far = makeRequest({ origin: pointNear(A, B, 0.5, 4000) });
    const g = gapsToRoute(far, pool);
    expect(g.startGapKm).toBeGreaterThan(3.5);
    expect(g.startGapKm).toBeLessThan(4.5);
    expect(g.endGapKm).toBeLessThan(1);
  });

  it('builds a near-miss entry with the pool details and the reasons', () => {
    const near = toNearbyPool(request, pool, 'SEATS');
    expect(near).toMatchObject({
      poolId: 'pool-1',
      route: { from: 'Indiranagar', to: 'Airport' },
      vehicle: { make: 'Honda' },
      seatsAvailable: 3,
      fare: { amount: 250, negotiable: false },
    });
    expect(near.why.length).toBeGreaterThan(0);
  });
});

describe('finding the nearest pools that do not fit', () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(clearDb);

  const repo = new MongoCandidateRepository();
  let counter = 0;
  async function seedPool(over: Record<string, unknown> & { from?: LatLng; to?: LatLng } = {}) {
    const { from = A, to = B, ...rest } = over;
    const distance = distanceMetres(from, to);
    counter += 1;
    return CarOwnerPool.create({
      userId: new Types.ObjectId(),
      origin: { label: 'Start', coordinates: from },
      destination: { label: 'End', coordinates: to },
      originPoint: { type: 'Point', coordinates: [from.lng, from.lat] },
      destinationPoint: { type: 'Point', coordinates: [to.lng, to.lat] },
      arriveBy: new Date(NOW.getTime() + 3 * HOUR),
      luggage: { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 },
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seatsOffered: 3,
      availableSeats: 3,
      pricingMode: 'FIXED',
      askingPrice: 250,
      maxDriverDetourKm: 5,
      route: { distanceMeters: distance, durationSeconds: distance / 10, computedAt: NOW },
      routeLine: { type: 'LineString', coordinates: straightLine(from, to).map(([lat, lng]) => [lng, lat]) },
      status: 'OPEN',
      dedupeKey: `nearby-${counter}`,
      ...rest,
    });
  }
  const matcherWith = (maps = new RoadMaps()) => new CarpoolMatcher({ maps, candidates: repo });

  it('returns the closest pool even though the pickup is beyond the passenger limit, with the reason', async () => {
    await seedPool();
    const request = makeRequest({ origin: pointNear(A, B, 0.4, 6000), maxPickupTravelKm: 2 });

    expect((await matcherWith().findOwnerMatches(request, { now: NOW })).matches).toEqual([]); // not a match...
    const near = await matcherWith().findNearestOwnerPools(request, { now: NOW });
    expect(near).toHaveLength(1); // ...but it is shown as the nearest
    expect(near[0]!.why[0]).toMatch(/km from your start/);
    expect(near[0]!.startGapKm).toBeGreaterThan(5);
  });

  it('orders by how close the route passes to the start, and shows at most the configured number', async () => {
    const request = makeRequest();
    for (let i = 0; i < MATCHING.NEAREST_POOLS + 2; i += 1) {
      // Every pool is too early for this passenger, so none fits; each runs a little further away.
      await seedPool({ from: { lat: A.lat + i * 0.01, lng: A.lng }, to: { lat: B.lat + i * 0.01, lng: B.lng }, arriveBy: new Date(NOW.getTime() + 20 * 60_000) });
    }
    const near = await matcherWith().findNearestOwnerPools(request, { now: NOW });
    expect(near.length).toBeLessThanOrEqual(MATCHING.NEAREST_POOLS);
    const gapsKm = near.map((n) => n.startGapKm);
    expect(gapsKm).toEqual([...gapsKm].sort((a, b) => a - b));
  });

  it('does not list a pool that actually fits (that is a match, not a near miss)', async () => {
    await seedPool();
    expect(await matcherWith().findNearestOwnerPools(makeRequest(), { now: NOW })).toEqual([]);
  });

  it('leaves out the passenger\'s own pool, pools that are not open, and pools that have already arrived', async () => {
    const mine = new Types.ObjectId();
    await seedPool({ userId: mine });
    await seedPool({ status: 'CANCELLED' });
    await seedPool({ status: 'FULL', availableSeats: 0 });
    await seedPool({ arriveBy: new Date(NOW.getTime() - HOUR) });
    const request = { ...makeRequest({ origin: pointNear(A, B, 0.4, 6000) }), userId: mine.toString() };
    expect(await matcherWith().findNearestOwnerPools(request, { now: NOW })).toEqual([]);
  });

  it('says why when seats are the problem', async () => {
    await seedPool({ availableSeats: 1 });
    const near = await matcherWith().findNearestOwnerPools(makeRequest({ people: 2 }), { now: NOW });
    expect(near[0]!.why).toEqual(['Only 1 seat free, and you need 2.']);
  });

  it('ignores a pool with no stored route, and one far outside the search radius', async () => {
    await seedPool({ from: { lat: 19.07, lng: 72.87 }, to: { lat: 18.52, lng: 73.85 } }); // Mumbai -> Pune
    expect(await matcherWith().findNearestOwnerPools(makeRequest(), { now: NOW })).toEqual([]);
  });

  it('says it could not check a pool when routing is down, instead of claiming anything', async () => {
    await seedPool();
    const maps = new RoadMaps();
    maps.failWith = new Error('routing down');
    const near = await matcherWith(maps).findNearestOwnerPools(makeRequest(), { now: NOW });
    expect(near).toHaveLength(1);
    expect(near[0]!.why).toEqual(["We couldn't check this pool just now."]);
  });
});
