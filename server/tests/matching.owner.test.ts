import { describe, expect, it } from 'vitest';
import { MATCHING } from '../src/config/matching.js';
import { AppError } from '../src/utils/errors.js';
import { distanceMetres } from '../src/utils/geo.js';
import { evaluateOwnerCandidate } from '../src/services/matching/ownerMatching.js';
import type { OwnerEvaluation, OwnerMatch } from '../src/services/matching/types.js';
import { A, B, HOUR, NOW, RoadMaps, makePool, makeRequest, pointNear } from './matchingHelpers.js';

const run = (over: { request?: Parameters<typeof makeRequest>[0]; pool?: Parameters<typeof makePool>[0]; maps?: RoadMaps } = {}) => {
  const maps = over.maps ?? new RoadMaps();
  return { maps, result: evaluateOwnerCandidate(makeRequest(over.request), makePool(over.pool), { maps, now: NOW }) };
};

const matchOf = (e: OwnerEvaluation): OwnerMatch => {
  if (!e.ok) throw new Error(`expected a match but was rejected: ${e.reason}`);
  return e.match;
};
const reasonOf = (e: OwnerEvaluation) => (e.ok ? 'MATCH' : e.reason);

describe('a compatible trip', () => {
  it('matches, with a score and plain-language reasons', async () => {
    const m = matchOf(await run().result);

    expect(m.section).toBe('CAR_OWNER');
    expect(m.poolId).toBe('pool-1');
    expect(m.score).toBeGreaterThan(50);
    expect(m.score).toBeLessThanOrEqual(100);
    expect(m.reasons.join(' ')).toMatch(/pickup is .* km from you by road, within your 2 km limit/i);
    expect(m.reasons.join(' ')).toMatch(/extra distance .* within their 5 km limit/i);
    expect(m.reasons.join(' ')).toMatch(/seats? free for your party of 1/i);
    expect(m.route).toEqual({ from: 'Indiranagar', to: 'Airport' });
    expect(m.fare).toEqual({ amount: 250, negotiable: false });
  });

  it('picks up and drops off at points on the driver\'s route, not at the passenger\'s own spots', async () => {
    const request = makeRequest();
    const m = matchOf(await run().result);

    // On the straight route: the pickup is ~1 km from where the passenger is, not 0.
    expect(m.pickup.roadKmFromRequestedPickup).toBeGreaterThan(0.8);
    expect(m.pickup.roadKmFromRequestedPickup).toBeLessThan(1.3);
    expect(distanceMetres({ lat: m.pickup.lat, lng: m.pickup.lng }, request.origin)).toBeGreaterThan(800);
    expect(m.dropoff.roadKmToDestination).toBeLessThan(0.8);
  });

  it('puts the pickup before the drop-off, and both before the driver arrives', async () => {
    const m = matchOf(await run().result);
    const pick = Date.parse(m.pickup.eta);
    const drop = Date.parse(m.dropoff.eta);
    expect(pick).toBeLessThan(drop);
    expect(drop).toBeLessThanOrEqual(makePool().arriveBy.getTime());
    expect(Date.parse(m.driverDepartsAt)).toBeLessThan(pick);
    expect(Date.parse(m.driverDepartsAt)).toBeGreaterThanOrEqual(NOW.getTime());
  });

  it('measures the driver\'s extra distance over the whole revised itinerary, by road', async () => {
    const { maps, result } = run();
    const m = matchOf(await result);

    expect(maps.itineraryCalls).toHaveLength(1);
    const [points] = maps.itineraryCalls;
    expect(points).toHaveLength(4); // origin, pickup, drop-off, destination
    expect(points![0]).toEqual(A);
    expect(points![3]).toEqual(B);
    expect(m.driverDetourKm).toBeLessThan(0.2); // the stops are on the route, so almost no extra distance
  });

  it('uses real road distance for the passenger\'s walk, not just the straight line', async () => {
    const maps = new RoadMaps();
    maps.roadFactor = 1.4; // roads wind: 1 km as the crow flies is 1.4 km by road
    const m = matchOf(await run({ maps }).result);
    expect(m.pickup.roadKmFromRequestedPickup).toBeGreaterThan(1.2);
  });
});

describe('route compatibility', () => {
  it('matches even when the driver\'s start is far from the passenger, if the route passes close by', async () => {
    const farStart = { lat: 12.75, lng: 77.55 };
    const pool = makePool({ origin: farStart, destination: B });
    const request = makeRequest({ origin: pointNear(farStart, B, 0.6, 800), destination: pointNear(farStart, B, 0.95, 300) });
    expect(distanceMetres(request.origin, farStart)).toBeGreaterThan(15_000);

    const result = await evaluateOwnerCandidate(request, pool, { maps: new RoadMaps(), now: NOW });
    expect(reasonOf(result)).toBe('MATCH');
  });

  it('rejects a passenger travelling the opposite way along the same road', async () => {
    const owner = makePool();
    const request = makeRequest({
      origin: pointNear(owner.origin, owner.destination, 0.9, 500),
      destination: pointNear(owner.origin, owner.destination, 0.2, 500),
    });
    expect(reasonOf(await evaluateOwnerCandidate(request, owner, { maps: new RoadMaps(), now: NOW }))).toBe('ROUTE_ORDER');
  });

  it('rejects a ride that would be shorter than the minimum', async () => {
    const owner = makePool();
    const request = makeRequest({
      origin: pointNear(owner.origin, owner.destination, 0.5, 100),
      destination: pointNear(owner.origin, owner.destination, 0.5005, 100), // ~12 m further along
      maxDropoffTravelKm: 0.15, // tight, so the driver cannot simply drop them at a stop further on
    });
    expect(reasonOf(await evaluateOwnerCandidate(request, owner, { maps: new RoadMaps(), now: NOW }))).toBe('ROUTE_ORDER');
  });

  it('rejects a passenger whose pickup is nowhere near the route', async () => {
    const request = makeRequest({ origin: pointNear(A, B, 0.2, 9000) });
    expect(reasonOf(await run({ request }).result)).toBe('PICKUP_TOO_FAR');
  });

  it('rejects a passenger whose destination is nowhere near the route when they set a drop-off limit', async () => {
    const request = makeRequest({ destination: pointNear(A, B, 0.9, 9000), maxDropoffTravelKm: 2 });
    expect(reasonOf(await run({ request }).result)).toBe('DROPOFF_TOO_FAR');
  });
});

describe('passenger pickup tolerance (maxPickupTravelKm)', () => {
  it('accepts a pickup within the limit and rejects it just above', async () => {
    // the passenger is ~1 km off the route
    expect(reasonOf(await run({ request: { maxPickupTravelKm: 1.5 } }).result)).toBe('MATCH');
    expect(reasonOf(await run({ request: { maxPickupTravelKm: 0.5 } }).result)).toBe('PICKUP_TOO_FAR');
  });

  it('rejects when the straight line is within the limit but the real road is not', async () => {
    const maps = new RoadMaps();
    maps.roadFactor = 3; // a river, a flyover, a one-way system: the road is far longer than the crow flies
    const result = await run({ maps, request: { maxPickupTravelKm: 1.5 } }).result;
    expect(reasonOf(result)).toBe('PICKUP_TOO_FAR');
  });

  it('rejects when there is no road at all from the passenger to the route', async () => {
    const maps = new RoadMaps();
    const request = makeRequest();
    const roads = maps.getRoute.bind(maps);
    // Nothing can be reached by road from where the passenger stands (an island, a gated area).
    maps.getRoute = async (from, to) => {
      if (distanceMetres(from, request.origin) < 5) throw new AppError(422, 'NO_ROUTE', 'No driving route was found.');
      return roads(from, to);
    };
    const result = await evaluateOwnerCandidate(request, makePool(), { maps, now: NOW });
    expect(reasonOf(result)).toBe('PICKUP_TOO_FAR'); // a missing road is a rejection, not a routing outage
  });
});

describe('optional drop-off tolerance (maxDropoffTravelKm)', () => {
  it('is enforced when given', async () => {
    expect(reasonOf(await run({ request: { maxDropoffTravelKm: 0.1 } }).result)).toBe('DROPOFF_TOO_FAR');
    expect(reasonOf(await run({ request: { maxDropoffTravelKm: 1 } }).result)).toBe('MATCH');
  });

  it('is not enforced, and not scored as zero, when the passenger set none', async () => {
    const withLimit = matchOf(await run().result);
    const request = makeRequest();
    delete request.maxDropoffTravelKm;
    const without = matchOf(await evaluateOwnerCandidate(request, makePool(), { maps: new RoadMaps(), now: NOW }));

    expect(without.breakdown.map((c) => c.key)).not.toContain('dropoff');
    expect(withLimit.breakdown.map((c) => c.key)).toContain('dropoff');
    expect(without.breakdown.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 2);
  });
});

describe('driver detour (maxDriverDetourKm), independent of the passenger\'s pickup limit', () => {
  it('rejects when the revised itinerary adds more than the owner allows', async () => {
    const maps = new RoadMaps();
    maps.extraMeters = 6000;
    expect(reasonOf(await run({ maps, pool: { maxDriverDetourKm: 5 } }).result)).toBe('DETOUR');
  });

  it('accepts when it adds less, and reports the extra distance', async () => {
    const maps = new RoadMaps();
    maps.extraMeters = 4000;
    const m = matchOf(await run({ maps, pool: { maxDriverDetourKm: 5 } }).result);
    expect(m.driverDetourKm).toBeCloseTo(3.9, 1); // 4000 m less the 100 m routing noise allowance
  });

  it('the two limits are separate: a generous pickup limit does not excuse a big detour', async () => {
    const maps = new RoadMaps();
    maps.extraMeters = 3000;
    const result = await run({ maps, pool: { maxDriverDetourKm: 2 }, request: { maxPickupTravelKm: 20 } }).result;
    expect(reasonOf(result)).toBe('DETOUR');
  });

  it('and a generous driver limit does not excuse a pickup that is too far for the passenger', async () => {
    const result = await run({ pool: { maxDriverDetourKm: 50 }, request: { maxPickupTravelKm: 0.3 } }).result;
    expect(reasonOf(result)).toBe('PICKUP_TOO_FAR');
  });

  it('a small detour passes a tight driver limit while the passenger still walks 1.5 km', async () => {
    const maps = new RoadMaps();
    maps.extraMeters = 900;
    const m = matchOf(await run({ maps, pool: { maxDriverDetourKm: 1 }, request: { maxPickupTravelKm: 2 } }).result);
    expect(m.driverDetourKm).toBeLessThanOrEqual(1);
    expect(m.pickup.roadKmFromRequestedPickup).toBeGreaterThan(0.8);
  });

  it('never reports a negative detour', async () => {
    const maps = new RoadMaps();
    maps.extraMeters = -500; // a shorter revised route than planned (routing differences)
    expect(matchOf(await run({ maps }).result).driverDetourKm).toBe(0);
  });

  it('treats a zero-detour owner as willing to drive only exactly their route', async () => {
    expect(reasonOf(await run({ pool: { maxDriverDetourKm: 0 } }).result)).toBe('MATCH');
    const maps = new RoadMaps();
    maps.extraMeters = 1000;
    expect(reasonOf(await run({ maps, pool: { maxDriverDetourKm: 0 } }).result)).toBe('DETOUR');
  });
});

describe('existing confirmed stops stay in the itinerary', () => {
  it('keeps them in route order, with the new stops inserted by position along the route', async () => {
    const owner = makePool();
    const stopPickup = pointNear(A, B, 0.1, 100);
    const stopDropoff = pointNear(A, B, 0.5, 100);
    const pool = makePool({ confirmedStops: [{ seats: 1, pickup: stopPickup, dropoff: stopDropoff }] });
    const maps = new RoadMaps();

    const m = matchOf(await evaluateOwnerCandidate(makeRequest(), pool, { maps, now: NOW }));

    // The original itinerary (with the confirmed rider) is the baseline, and the revised one adds the new stops.
    expect(maps.itineraryCalls).toHaveLength(2);
    expect(maps.itineraryCalls[0]).toEqual([owner.origin, stopPickup, stopDropoff, owner.destination]);
    const revised = maps.itineraryCalls[1]!;
    expect(revised).toHaveLength(6);
    expect(revised[0]).toEqual(A);
    expect(revised.at(-1)).toEqual(B);
    expect(revised).toContainEqual(stopPickup);
    expect(revised).toContainEqual(stopDropoff);
    // new pickup (20% of the way) falls between the existing pickup (10%) and drop-off (50%)
    const at = (p: { lat: number; lng: number }) => revised.findIndex((q) => q.lat === p.lat && q.lng === p.lng);
    expect(at(stopPickup)).toBeLessThan(at({ lat: m.pickup.lat, lng: m.pickup.lng }));
    expect(at({ lat: m.pickup.lat, lng: m.pickup.lng })).toBeLessThan(at(stopDropoff));
  });

  it('measures the detour against the itinerary with the existing riders, not the bare route', async () => {
    const pool = makePool({ confirmedStops: [{ seats: 1, pickup: pointNear(A, B, 0.1, 100), dropoff: pointNear(A, B, 0.5, 100) }] });
    const maps = new RoadMaps();
    maps.extraMeters = 4000; // applies to both itineraries, so it cancels out
    const m = matchOf(await evaluateOwnerCandidate(makeRequest(), pool, { maps, now: NOW }));
    expect(m.driverDetourKm).toBeLessThan(0.3);
  });
});

describe('departure time', () => {
  it('rejects a pool the passenger would arrive at too late: the owner reaches the end long after the deadline', async () => {
    const request = makeRequest({ arriveBy: new Date(NOW.getTime() + 0.5 * HOUR) }); // needs to be there in 30 min
    expect(reasonOf(await run({ request }).result)).toBe('TIME');
  });

  it('rejects a pool that would drop them off far too early', async () => {
    const request = makeRequest({ arriveBy: new Date(NOW.getTime() + 8 * HOUR) }); // owner arrives 5 hours before
    expect(reasonOf(await run({ request }).result)).toBe('TIME');
  });

  it('accepts a drop-off a little before the deadline, and scores it higher than a much earlier one', async () => {
    const ownerArrive = makePool().arriveBy.getTime();
    const close = matchOf(await run({ request: { arriveBy: new Date(ownerArrive + 5 * 60_000) } }).result);
    const early = matchOf(await run({ request: { arriveBy: new Date(ownerArrive + 70 * 60_000) } }).result);
    const time = (m: OwnerMatch) => m.breakdown.find((c) => c.key === 'time')!.value;
    expect(time(close)).toBeGreaterThan(time(early));
    expect(close.score).toBeGreaterThan(early.score);
  });

  it('rejects when the drop-off would be after the passenger\'s deadline', async () => {
    const ownerArrive = makePool().arriveBy.getTime();
    // The drop-off is a few minutes before the owner reaches the end, so a deadline 10 minutes before that is missed.
    const request = makeRequest({ arriveBy: new Date(ownerArrive - 10 * 60_000) });
    expect(reasonOf(await run({ request }).result)).toBe('TIME');
  });

  it('accepts a deadline only just after the drop-off', async () => {
    const ownerArrive = makePool().arriveBy.getTime();
    const request = makeRequest({ arriveBy: new Date(ownerArrive - 60_000) }); // drop-off is ~4 min before ownerArrive
    expect(reasonOf(await run({ request }).result)).toBe('MATCH');
  });

  it('rejects a pool whose driver would already have set off', async () => {
    const pool = { arriveBy: new Date(NOW.getTime() + 10 * 60_000) }; // needs ~41 min of driving, only 10 min away
    const request = { arriveBy: new Date(NOW.getTime() + 10 * 60_000) };
    expect(reasonOf(await run({ pool, request }).result)).toBe('UNAVAILABLE');
  });
});

describe('seats and luggage', () => {
  it('rejects when there are not enough seats', async () => {
    expect(reasonOf(await run({ pool: { availableSeats: 1 }, request: { people: 2 } }).result)).toBe('SEATS');
    expect(reasonOf(await run({ pool: { availableSeats: 0 } }).result)).toBe('SEATS');
  });

  it('accepts exactly as many people as there are seats', async () => {
    expect(reasonOf(await run({ pool: { availableSeats: 2 }, request: { people: 2 } }).result)).toBe('MATCH');
  });

  it('rejects when the luggage does not fit, and accepts when it fits exactly', async () => {
    expect(reasonOf(await run({ pool: { luggageUnitsAvailable: 2 }, request: { luggageUnits: 3 } }).result)).toBe('LUGGAGE');
    expect(reasonOf(await run({ pool: { luggageUnitsAvailable: 3 }, request: { luggageUnits: 3 } }).result)).toBe('MATCH');
  });

  it('checks seats and luggage before spending any routing calls', async () => {
    const { maps, result } = run({ pool: { availableSeats: 0 } });
    await result;
    expect(maps.routeCalls).toHaveLength(0);
    expect(maps.itineraryCalls).toHaveLength(0);
  });
});

describe('budget', () => {
  it('rejects a fixed fare above the passenger\'s maximum', async () => {
    expect(reasonOf(await run({ pool: { askingPrice: 400, negotiable: false }, request: { maxBudget: 300 } }).result)).toBe('BUDGET');
  });

  it('keeps a negotiable fare above budget (it is not a reliable price), but scores it lower', async () => {
    const over = matchOf(await run({ pool: { askingPrice: 400, negotiable: true }, request: { maxBudget: 300 } }).result);
    const under = matchOf(await run({ pool: { askingPrice: 100, negotiable: true }, request: { maxBudget: 300 } }).result);
    expect(over.reasons.join(' ')).toMatch(/above your budget, but the owner says it is negotiable/i);
    expect(under.score).toBeGreaterThan(over.score);
  });

  it('accepts a fare exactly at the budget', async () => {
    expect(reasonOf(await run({ pool: { askingPrice: 300 }, request: { maxBudget: 300 } }).result)).toBe('MATCH');
  });

  it('ignores price completely when the passenger set no budget', async () => {
    const m = matchOf(await run({ pool: { askingPrice: 99_999 } }).result);
    expect(m.breakdown.map((c) => c.key)).not.toContain('budget');
  });

  it('a cheaper fare ranks higher than a dearer one, all else equal', async () => {
    const cheap = matchOf(await run({ pool: { askingPrice: 100 }, request: { maxBudget: 500 } }).result);
    const dear = matchOf(await run({ pool: { askingPrice: 450 }, request: { maxBudget: 500 } }).result);
    expect(cheap.score).toBeGreaterThan(dear.score);
  });
});

describe('pool availability and bad data', () => {
  it('never matches a person with their own pool', async () => {
    expect(reasonOf(await run({ pool: { userId: 'passenger-1' } }).result)).toBe('UNAVAILABLE');
  });

  it('rejects a pool with no stored route instead of guessing', async () => {
    const pool = makePool();
    pool.route.line = [];
    expect(reasonOf(await evaluateOwnerCandidate(makeRequest(), pool, { maps: new RoadMaps(), now: NOW }))).toBe('NO_ROUTE_DATA');
  });
});

describe('routing failures never produce a match', () => {
  it('reports a routing outage as an error, not as a match or a clean rejection', async () => {
    const maps = new RoadMaps();
    maps.failWith = new AppError(502, 'MAPS_UNAVAILABLE', 'down');
    const result = await run({ maps }).result;
    expect(result).toEqual({ ok: false, reason: 'ROUTING_ERROR' });
  });

  it('treats a network error the same way', async () => {
    const maps = new RoadMaps();
    maps.failWith = new TypeError('fetch failed');
    expect((await run({ maps }).result).ok).toBe(false);
  });

  it('does not let a routing failure on the revised itinerary slip through', async () => {
    const maps = new RoadMaps();
    maps.getItinerary = async () => {
      throw new AppError(502, 'MAPS_UNAVAILABLE', 'down');
    };
    expect(await run({ maps }).result).toEqual({ ok: false, reason: 'ROUTING_ERROR' });
  });

  it('treats "no road for the whole itinerary" as a rejection, not an outage', async () => {
    const maps = new RoadMaps();
    maps.getItinerary = async () => {
      throw new AppError(422, 'NO_ROUTE', 'no road');
    };
    expect(reasonOf(await run({ maps }).result)).toBe('ROUTE_ORDER');
  });
});

describe('ranking inputs', () => {
  it('a closer pickup scores higher than a farther one, all else equal', async () => {
    const near = matchOf(await run({ request: { origin: pointNear(A, B, 0.2, 300) } }).result);
    const far = matchOf(await run({ request: { origin: pointNear(A, B, 0.2, 1800) } }).result);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('a smaller driver detour scores higher than a larger one', async () => {
    const small = new RoadMaps();
    small.extraMeters = 500;
    const big = new RoadMaps();
    big.extraMeters = 4000;
    const a = matchOf(await run({ maps: small }).result);
    const b = matchOf(await run({ maps: big }).result);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('every returned score is within 0..100 and the weights are the configured ones', async () => {
    const m = matchOf(await run({ request: { maxBudget: 500 } }).result);
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(100);
    for (const c of m.breakdown) expect(c.weight).toBeCloseTo(MATCHING.WEIGHTS[c.key] / Object.values(MATCHING.WEIGHTS).reduce((a, b) => a + b, 0), 2);
  });
});
