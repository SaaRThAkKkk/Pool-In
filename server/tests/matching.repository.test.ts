import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { MATCHING } from '../src/config/matching.js';
import { CabPool } from '../src/models/CabPool.js';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { distanceMetres, type LatLng } from '../src/utils/geo.js';
import { MongoCandidateRepository } from '../src/services/matching/candidateRepository.js';
import { CarpoolMatcher } from '../src/services/matching/matcher.js';
import type { PassengerRequest } from '../src/services/matching/types.js';
import { clearDb, startTestDb, stopTestDb } from './helpers.js';
import { A, B, HOUR, NOW, RoadMaps, makeRequest, pointNear, straightLine } from './matchingHelpers.js';

const repo = new MongoCandidateRepository();
const newMatcher = (maps = new RoadMaps()) => ({ maps, matcher: new CarpoolMatcher({ maps, candidates: repo }) });

let counter = 0;
// An open car-owner pool, written straight to the database with a stored route (like a published pool).
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
    dedupeKey: `seed-${counter}`,
    ...rest,
  });
}

async function seedCab(over: Record<string, unknown> & { from?: LatLng; to?: LatLng } = {}) {
  const { from = A, to = B, ...rest } = over;
  counter += 1;
  return CabPool.create({
    userId: new Types.ObjectId(),
    origin: { label: 'Start', coordinates: from },
    destination: { label: 'End', coordinates: to },
    originPoint: { type: 'Point', coordinates: [from.lng, from.lat] },
    destinationPoint: { type: 'Point', coordinates: [to.lng, to.lat] },
    arriveBy: new Date(NOW.getTime() + 3 * HOUR + 10 * 60_000),
    luggage: { large: 0, medium: 0, cabin: 1, backpack: 0, oversized: 0 },
    peopleCount: 1,
    maxPickupTravelKm: 2,
    maxDropoffTravelKm: 2,
    status: 'OPEN',
    dedupeKey: `cab-${counter}`,
    ...rest,
  });
}

const idsOf = (pools: { id: string }[]) => pools.map((p) => p.id).sort();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('finding candidate car-owner pools in the database', () => {
  it('finds a pool whose route passes the passenger, even though its start is far away', async () => {
    const farStart = { lat: 12.75, lng: 77.55 }; // ~25+ km from the passenger
    const pool = await seedPool({ from: farStart, to: B });
    const request = makeRequest({ origin: pointNear(farStart, B, 0.6, 800), destination: pointNear(farStart, B, 0.95, 300) });
    expect(distanceMetres(request.origin, farStart)).toBeGreaterThan(15_000);

    const found = await repo.ownerPools(request, { now: NOW });
    expect(found.map((c) => c.id)).toEqual([pool.id]);
  });

  it('does not return a pool whose route is nowhere near the passenger', async () => {
    await seedPool({ from: { lat: 19.07, lng: 72.87 }, to: { lat: 18.52, lng: 73.85 } }); // Mumbai -> Pune
    expect(await repo.ownerPools(makeRequest(), { now: NOW })).toEqual([]);
  });

  it('requires the route to pass near the destination too', async () => {
    const pool = await seedPool();
    const toElsewhere = makeRequest({ destination: pointNear(A, B, 0.9, 40_000), maxDropoffTravelKm: 2 });
    expect(await repo.ownerPools(toElsewhere, { now: NOW })).toEqual([]);
    expect((await repo.ownerPools(makeRequest(), { now: NOW })).map((c) => c.id)).toEqual([pool.id]);
  });

  it('skips pools that are cancelled, full, expired or for someone else\'s trip', async () => {
    const open = await seedPool();
    await seedPool({ status: 'CANCELLED' });
    await seedPool({ status: 'FULL', availableSeats: 0 });
    await seedPool({ status: 'COMPLETED' });
    await seedPool({ status: 'IN_PROGRESS' });
    expect((await repo.ownerPools(makeRequest(), { now: NOW })).map((c) => c.id)).toEqual([open.id]);
  });

  it('includes a partly filled pool that still has room', async () => {
    const partly = await seedPool({ status: 'PARTIALLY_FILLED', availableSeats: 1 });
    expect((await repo.ownerPools(makeRequest(), { now: NOW })).map((c) => c.id)).toEqual([partly.id]);
  });

  it('filters by seats', async () => {
    await seedPool({ availableSeats: 1, seatsOffered: 3 });
    expect(await repo.ownerPools(makeRequest({ people: 2 }), { now: NOW })).toEqual([]);
    expect(await repo.ownerPools(makeRequest({ people: 1 }), { now: NOW })).toHaveLength(1);
  });

  it('filters by arrival time: far too early or far too late is left out', async () => {
    const request = makeRequest();
    await seedPool({ arriveBy: new Date(request.arriveBy.getTime() - 5 * HOUR) });
    await seedPool({ arriveBy: new Date(request.arriveBy.getTime() + 9 * HOUR) });
    const ok = await seedPool({ arriveBy: new Date(request.arriveBy.getTime() - 20 * 60_000) });
    expect((await repo.ownerPools(request, { now: NOW })).map((c) => c.id)).toEqual([ok.id]);
  });

  it('never returns the passenger\'s own pool', async () => {
    const mine = new Types.ObjectId();
    await seedPool({ userId: mine });
    const request = makeRequest({ userId: mine.toString() });
    expect(await repo.ownerPools(request, { now: NOW })).toEqual([]);
  });

  it('skips pools that have no stored route instead of guessing', async () => {
    await seedPool({ route: undefined, routeLine: undefined });
    expect(await repo.ownerPools(makeRequest(), { now: NOW })).toEqual([]);
  });

  it('only looks at pools published after a given moment (used while a search is running)', async () => {
    const before = await seedPool();
    const since = new Date(Date.now() + 1);
    await new Promise((r) => setTimeout(r, 5));
    const after = await seedPool();

    expect((await repo.ownerPools(makeRequest(), { now: NOW })).map((c) => c.id).sort()).toEqual([before.id, after.id].sort());
    expect((await repo.ownerPools(makeRequest(), { now: NOW, createdAfter: since })).map((c) => c.id)).toEqual([after.id]);
  });

  it('can be limited to specific pools', async () => {
    const one = await seedPool();
    await seedPool();
    expect((await repo.ownerPools(makeRequest(), { now: NOW, poolIds: [one.id] })).map((c) => c.id)).toEqual([one.id]);
  });

  it('caps how many candidates go on to real routing, keeping the closest ones', async () => {
    const closest = await seedPool();
    for (let i = 0; i < MATCHING.MAX_CANDIDATES + 10; i++) {
      await seedPool({ from: pointNear(A, B, 0, 3000 + i * 20), to: pointNear(A, B, 1, 3000 + i * 20), dedupeKey: `far-${i}` });
    }
    const found = await repo.ownerPools(makeRequest({ maxPickupTravelKm: 5, maxDropoffTravelKm: 5 }), { now: NOW });
    expect(found.length).toBeLessThanOrEqual(MATCHING.MAX_CANDIDATES);
    expect(found.map((c) => c.id)).toContain(closest.id);
  });

  it('turns a stored pool into what the matcher needs: [lat,lng] route, luggage space, tolerances', async () => {
    await seedPool({ maxDriverDetourKm: 3, luggageSpaceUnits: 5, luggageUsedUnits: 2, askingPrice: 180, pricingMode: 'NEGOTIABLE' });
    const [c] = await repo.ownerPools(makeRequest(), { now: NOW });

    expect(c!.maxDriverDetourKm).toBe(3);
    expect(c!.luggageUnitsAvailable).toBe(3); // 5 declared, 2 already promised
    expect(c!.negotiable).toBe(true);
    expect(c!.askingPrice).toBe(180);
    expect(c!.route.line[0]).toEqual([A.lat, A.lng]); // GeoJSON [lng,lat] converted back
    expect(c!.route.line.at(-1)).toEqual([B.lat, B.lng]);
    expect(c!.origin).toEqual(A);
  });

  it('uses a default luggage space for the vehicle type when the owner did not declare one', async () => {
    await seedPool({ luggage: { large: 1, medium: 0, cabin: 0, backpack: 0, oversized: 0 } });
    const [c] = await repo.ownerPools(makeRequest(), { now: NOW });
    expect(c!.luggageUnitsAvailable).toBe(MATCHING.CATEGORY_LUGGAGE_UNITS.SEDAN - 2); // the owner's own large suitcase takes room
  });
});

describe('the matcher, end to end against the database', () => {
  it('returns feasible pools ranked best first, and says how many were rejected and why', async () => {
    const near = await seedPool({ from: pointNear(A, B, 0, 0), to: B });
    // Same trip, but the passenger would have to travel further to reach it.
    const far = await seedPool({ from: pointNear(A, B, 0, 1800), to: pointNear(A, B, 1, 1800) });
    await seedPool({ availableSeats: 0, status: 'FULL' }); // not even a candidate
    await seedPool({ askingPrice: 900 }); // fixed fare above the passenger's budget

    const { matcher } = newMatcher();
    const request = makeRequest({ maxBudget: 300, maxPickupTravelKm: 3 });
    const result = await matcher.findOwnerMatches(request, { now: NOW });

    expect(result.status).toBe('OK');
    expect(result.matches.map((m) => m.poolId)).toEqual([near.id, far.id]);
    expect(result.matches[0]!.score).toBeGreaterThan(result.matches[1]!.score);
    expect(result.rejected.BUDGET).toBe(1);
    expect(result.routingFailures).toBe(0);
    expect(result.sections).toEqual(['CAR_OWNER', 'CAB']);
  });

  it('returns at most the configured number of matches', async () => {
    for (let i = 0; i < MATCHING.MAX_RESULTS + 3; i++) await seedPool({ dedupeKey: `m-${i}` });
    const { matcher } = newMatcher();
    const result = await matcher.findOwnerMatches(makeRequest(), { now: NOW });
    expect(result.matches).toHaveLength(MATCHING.MAX_RESULTS);
  });

  it('reports an empty, honest result when nothing fits', async () => {
    const { matcher } = newMatcher();
    expect(await matcher.findOwnerMatches(makeRequest(), { now: NOW })).toMatchObject({ status: 'OK', matches: [], checked: 0 });
  });

  it('never reports a match it could not verify: a routing outage gives no matches and a DEGRADED status', async () => {
    await seedPool();
    const maps = new RoadMaps();
    maps.failWith = new Error('routing is down');
    const { matcher } = newMatcher(maps);

    const result = await matcher.findOwnerMatches(makeRequest(), { now: NOW });
    expect(result.matches).toEqual([]);
    expect(result.status).toBe('DEGRADED');
    expect(result.routingFailures).toBe(1);
  });

  it('still returns the pools it could verify when routing fails for others', async () => {
    const good = await seedPool();
    await seedPool({ from: pointNear(A, B, 0, 100), to: pointNear(A, B, 1, 100) });
    const maps = new RoadMaps();
    const itinerary = maps.getItinerary.bind(maps);
    let first = true;
    maps.getItinerary = async (points) => {
      // fail for one of the two candidates only
      if (first && distanceMetres(points[0]!, A) > 50) {
        first = false;
        throw new Error('flaky routing');
      }
      return itinerary(points);
    };
    const { matcher } = newMatcher(maps);
    const result = await matcher.findOwnerMatches(makeRequest(), { now: NOW });

    expect(result.status).toBe('DEGRADED');
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches.map((m) => m.poolId)).toContain(good.id);
  });

  it('does not run on every pool in the database, only on candidates near the passenger', async () => {
    await seedPool();
    for (let i = 0; i < 15; i++) await seedPool({ from: { lat: 19.07 + i * 0.01, lng: 72.87 }, to: { lat: 18.52, lng: 73.85 }, dedupeKey: `mum-${i}` });
    const { maps, matcher } = newMatcher();
    const result = await matcher.findOwnerMatches(makeRequest(), { now: NOW });

    expect(result.checked).toBe(1);
    expect(maps.itineraryCalls).toHaveLength(1);
  });

  it('checks one specific new pool directly', async () => {
    const pool = await seedPool();
    const [candidate] = await repo.ownerPools(makeRequest(), { now: NOW });
    const { matcher } = newMatcher();

    expect((await matcher.evaluatePool(makeRequest(), candidate!, NOW)) !== null).toBe(true);
    expect(await matcher.evaluatePool(makeRequest({ people: 9 }), candidate!, NOW)).toBeNull();
    const down = new RoadMaps();
    down.failWith = new Error('down');
    expect(await newMatcher(down).matcher.evaluatePool(makeRequest(), candidate!, NOW)).toBe('ROUTING_ERROR');
    expect(pool.id).toBe(candidate!.id);
  });
});

describe('passenger-to-passenger candidates', () => {
  const me = (over: Partial<PassengerRequest> = {}): PassengerRequest => ({
    userId: new Types.ObjectId().toString(),
    origin: pointNear(A, B, 0.1, 400),
    destination: pointNear(A, B, 0.95, 300),
    arriveBy: new Date(NOW.getTime() + 3 * HOUR),
    people: 1,
    luggageUnits: 1,
    maxPickupTravelKm: 2,
    maxDropoffTravelKm: 2,
    ...over,
  });
  const near = (over: Record<string, unknown> = {}) =>
    seedCab({ from: pointNear(A, B, 0.12, -500), to: pointNear(A, B, 0.96, -200), ...over });

  it('finds open requests heading the same way at about the same time, and proposes a group', async () => {
    const other = await near();
    const { matcher } = newMatcher();
    const result = await matcher.findPassengerMatches(me(), { now: NOW });

    expect(result.status).toBe('OK');
    expect(result.matches.map((m) => m.requestId)).toEqual([other.id]);
    expect(result.matches[0]!.note).toMatch(/not a confirmed ride/i);
  });

  it('ignores cancelled and finished requests, and the passenger\'s own', async () => {
    const mine = new Types.ObjectId();
    await near({ status: 'CANCELLED' });
    await near({ status: 'EXPIRED' });
    await near({ userId: mine });
    const ok = await near();

    const found = await repo.peerRequests(me({ userId: mine.toString() }), { now: NOW });
    expect(found.map((p) => p.id)).toEqual([ok.id]);
  });

  it('also finds a request that is still in its own five-minute search, so the second person to search sees the first', async () => {
    const searching = await near({ status: 'SEARCHING', searchExpiresAt: new Date(NOW.getTime() + 4 * 60_000) });
    const open = await near();
    const found = await repo.peerRequests(me(), { now: NOW });
    expect(found.map((p) => p.id).sort()).toEqual([searching.id, open.id].sort());

    const { matcher } = newMatcher();
    expect((await matcher.findPassengerMatches(me(), { now: NOW })).matches.map((m) => m.requestId).sort()).toEqual([searching.id, open.id].sort());
  });

  it('leaves out requests at a different time, too many people together, or heading elsewhere', async () => {
    await near({ arriveBy: new Date(NOW.getTime() + 3 * HOUR + 2 * HOUR) });
    await near({ peopleCount: 4 });
    await seedCab({ from: pointNear(A, B, 0.12, -500), to: pointNear(A, B, 0.4, 30_000) });
    const ok = await near();
    expect((await repo.peerRequests(me(), { now: NOW })).map((p) => p.id)).toEqual([ok.id]);
  });

  it('does not return a request without coordinates', async () => {
    await seedCab({ origin: { label: 'Typed only' }, originPoint: undefined, destinationPoint: undefined });
    expect(await repo.peerRequests(me(), { now: NOW })).toEqual([]);
  });

  it('does not match a passenger with their own saved request (by id)', async () => {
    const mine = await near();
    const asRequest = (await repo.peerRequests(me(), { now: NOW }))[0]!;
    expect(asRequest.id).toBe(mine.id);
    expect(await repo.peerRequests({ ...asRequest, userId: new Types.ObjectId().toString() }, { now: NOW })).toEqual([]);
  });
});
