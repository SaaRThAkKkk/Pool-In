import { describe, expect, it } from 'vitest';
import { MATCHING } from '../src/config/matching.js';
import { AppError } from '../src/utils/errors.js';
import { evaluatePassengerPair } from '../src/services/matching/passengerMatching.js';
import type { PassengerEvaluation, PassengerMatch, PassengerRequest, PeerRequest } from '../src/services/matching/types.js';
import { A, B, NOW, RoadMaps, pointNear } from './matchingHelpers.js';

const ARRIVE = new Date(NOW.getTime() + 3 * 3_600_000);

const me = (over: Partial<PassengerRequest> = {}): PassengerRequest => ({
  userId: 'me',
  origin: pointNear(A, B, 0.1, 400),
  destination: pointNear(A, B, 0.95, 300),
  arriveBy: ARRIVE,
  people: 1,
  luggageUnits: 1,
  maxPickupTravelKm: 2,
  maxDropoffTravelKm: 2,
  ...over,
});

// Someone a little further along the same road, heading to the same area.
const peer = (over: Partial<PeerRequest> = {}): PeerRequest => ({
  id: 'req-2',
  userId: 'other',
  origin: pointNear(A, B, 0.12, -500),
  destination: pointNear(A, B, 0.96, -200),
  arriveBy: new Date(ARRIVE.getTime() + 10 * 60_000),
  people: 1,
  luggageUnits: 1,
  maxPickupTravelKm: 2,
  maxDropoffTravelKm: 2,
  ...over,
});

const run = (a: PassengerRequest, b: PeerRequest, maps = new RoadMaps()) => evaluatePassengerPair(a, b, { maps, now: NOW });
const matchOf = (e: PassengerEvaluation): PassengerMatch => {
  if (!e.ok) throw new Error(`expected a match but was rejected: ${e.reason}`);
  return e.match;
};
const reasonOf = (e: PassengerEvaluation) => (e.ok ? 'MATCH' : e.reason);

describe('two compatible passengers', () => {
  it('are proposed as a group, with a shared pickup and drop-off', async () => {
    const m = matchOf(await run(me(), peer()));

    expect(m.section).toBe('CAB');
    expect(m.requestId).toBe('req-2');
    expect(m.groupSize).toBe(2);
    expect(m.otherPeople).toBe(1);
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(100);
    expect(m.rideKm).toBeGreaterThan(10);
    expect(m.rideMinutes).toBeGreaterThan(0);
    expect(m.pickup.roadKmForYou).toBeLessThanOrEqual(2);
    expect(m.dropoff.roadKmForYou).toBeLessThanOrEqual(2);
  });

  it('are never presented as a confirmed ride: no driver, no vehicle, nothing booked', async () => {
    const m = matchOf(await run(me(), peer()));
    expect(m.note).toMatch(/not a confirmed ride/i);
    expect(m.note).toMatch(/no driver or vehicle/i);
    expect(m).not.toHaveProperty('vehicle');
    expect(m).not.toHaveProperty('driver');
    expect(m).not.toHaveProperty('fare');
    expect(JSON.stringify(m)).not.toMatch(/userId/); // the other person is not identified before both agree
  });

  it('does not rely on a fare estimate: the reasons say the split is agreed between them', async () => {
    const m = matchOf(await run(me(), peer()));
    expect(m.reasons.join(' ')).toMatch(/fare split cannot be estimated reliably/i);
    expect(m.breakdown.map((c) => c.key)).not.toContain('budget');
    expect(m.breakdown.map((c) => c.key)).not.toContain('detour');
  });

  it('chooses a meeting point both can reach within their own limits', async () => {
    const a = me({ maxPickupTravelKm: 1 });
    const b = peer({ maxPickupTravelKm: 1 });
    const m = matchOf(await run(a, b));
    expect(m.pickup.roadKmForYou).toBeLessThanOrEqual(1);
  });
});

describe('hard rules', () => {
  it('rejects someone matching with their own request', async () => {
    expect(reasonOf(await run(me(), peer({ userId: 'me' })))).toBe('UNAVAILABLE');
  });

  it('rejects a group too big for one cab, and accepts one that exactly fits', async () => {
    expect(reasonOf(await run(me({ people: 3 }), peer({ people: 2 })))).toBe('CAPACITY');
    expect(reasonOf(await run(me({ people: 2 }), peer({ people: 2 })))).toBe('MATCH');
    expect(MATCHING.CAB.MAX_PEOPLE).toBe(4);
  });

  it('rejects when the combined luggage does not fit', async () => {
    expect(reasonOf(await run(me({ luggageUnits: 4 }), peer({ luggageUnits: 3 })))).toBe('LUGGAGE');
    expect(reasonOf(await run(me({ luggageUnits: 3 }), peer({ luggageUnits: 3 })))).toBe('MATCH');
  });

  it('rejects arrival times too far apart, and accepts ones within the window', async () => {
    const far = peer({ arriveBy: new Date(ARRIVE.getTime() + 45 * 60_000) });
    expect(reasonOf(await run(me(), far))).toBe('TIME');
    const near = peer({ arriveBy: new Date(ARRIVE.getTime() + MATCHING.CAB.TIME_WINDOW_MIN * 60_000) });
    expect(reasonOf(await run(me(), near))).toBe('MATCH');
  });

  it('rejects travellers heading to different places', async () => {
    const elsewhere = peer({ destination: pointNear(A, B, 0.2, 15_000) });
    expect(reasonOf(await run(me(), elsewhere))).toBe('ROUTES_DIFFER');
  });

  it('rejects when their starting points are too far apart for either to reach a shared pickup', async () => {
    const farOrigin = peer({ origin: pointNear(A, B, 0.6, 400) }); // ~12 km further along the road
    expect(reasonOf(await run(me(), farOrigin))).toBe('PICKUP_TOO_FAR');
  });

  it('rejects when real road distances break a limit even though straight lines do not', async () => {
    const maps = new RoadMaps();
    maps.roadFactor = 4;
    expect(reasonOf(await run(me({ maxPickupTravelKm: 1 }), peer({ maxPickupTravelKm: 1 }), maps))).toBe('PICKUP_TOO_FAR');
  });

  it('enforces each passenger\'s own pickup limit, not an average', async () => {
    // I would travel far to the shared point, and my limit is tight.
    const far = peer({ origin: pointNear(A, B, 0.2, 400) });
    expect(reasonOf(await run(me({ maxPickupTravelKm: 0.2 }), far))).toBe('PICKUP_TOO_FAR');
  });

  it('enforces drop-off limits when both passengers set them', async () => {
    const a = me({ maxDropoffTravelKm: 0.05 });
    const b = peer({ destination: pointNear(A, B, 0.8, 0), maxDropoffTravelKm: 0.05 });
    expect(reasonOf(await run(a, b))).toBe('DROPOFF_TOO_FAR');
  });

  it('rejects a shared ride that would be too short to be worth sharing', async () => {
    const a = me({ origin: pointNear(A, B, 0.5, 100), destination: pointNear(A, B, 0.5, 300) });
    const b = peer({ origin: pointNear(A, B, 0.5, 120), destination: pointNear(A, B, 0.5, 280) });
    expect(reasonOf(await run(a, b))).toBe('TOO_SHORT');
  });
});

describe('optional drop-off limits', () => {
  it('are not enforced, and not scored as zero, when a passenger set none', async () => {
    const a = me();
    delete a.maxDropoffTravelKm;
    const m = matchOf(await run(a, peer()));
    expect(m.breakdown.map((c) => c.key)).not.toContain('dropoff');
    expect(m.breakdown.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 2);
  });

  it('are scored when both passengers set them', async () => {
    const m = matchOf(await run(me(), peer()));
    expect(m.breakdown.map((c) => c.key)).toContain('dropoff');
  });
});

describe('ranking inputs', () => {
  it('prefers a closer arrival time', async () => {
    const close = matchOf(await run(me(), peer({ arriveBy: new Date(ARRIVE.getTime() + 2 * 60_000) })));
    const apart = matchOf(await run(me(), peer({ arriveBy: new Date(ARRIVE.getTime() + 25 * 60_000) })));
    expect(close.score).toBeGreaterThan(apart.score);
  });

  it('prefers a pickup that needs less travelling', async () => {
    const near = matchOf(await run(me(), peer({ origin: pointNear(A, B, 0.1, 500) })));
    const far = matchOf(await run(me(), peer({ origin: pointNear(A, B, 0.2, 500) })));
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe('routing failures never produce a match', () => {
  it('reports an outage as an error', async () => {
    const maps = new RoadMaps();
    maps.failWith = new AppError(502, 'MAPS_UNAVAILABLE', 'down');
    expect(await run(me(), peer(), maps)).toEqual({ ok: false, reason: 'ROUTING_ERROR' });
  });

  it('reports a failure on the shared leg as an error too', async () => {
    const maps = new RoadMaps();
    const roads = maps.getRoute.bind(maps);
    let calls = 0;
    maps.getRoute = async (from, to) => {
      calls += 1;
      if (calls > 4) throw new AppError(502, 'MAPS_UNAVAILABLE', 'down'); // the shared-ride route is asked for last
      return roads(from, to);
    };
    expect(reasonOf(await run(me(), peer(), maps))).toBe('ROUTING_ERROR');
  });

  it('spends no routing at all on a pair that fails a cheap rule', async () => {
    const maps = new RoadMaps();
    await run(me({ people: 4 }), peer(), maps);
    expect(maps.routeCalls).toHaveLength(0);
  });
});
