import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { POOL_POLICY } from '../src/config/pools.js';
import { CabPool } from '../src/models/CabPool.js';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { User } from '../src/models/User.js';
import { clearDb, FakeMatcher, makeApp, startTestDb, stopTestDb } from './helpers.js';

const matcher = new FakeMatcher();
const app = makeApp({ matcher });
type Agent = ReturnType<typeof request.agent>;

async function signUp(email = 'rider@example.com', phone = '9876543210', application = app) {
  const agent = request.agent(application);
  const res = await agent.post('/api/auth/register').send({ name: 'Rider One', email, phone, password: 'Passw0rdOK' });
  expect(res.status).toBe(201);
  return agent;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const common = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
  destination: { label: 'Kempegowda Airport', coordinates: { lat: 13.1986, lng: 77.7066 } },
  arriveBy: hoursFromNow(48),
  luggage: { large: 1, medium: 0, cabin: 1, backpack: 2, oversized: 0 },
  ...over,
});

const ownVehicle = (over: Record<string, unknown> = {}) => ({
  mode: 'OWN_VEHICLE',
  ...common(),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: true,
  ...over,
});

const poolCab = (over: Record<string, unknown> = {}) => ({ mode: 'POOL_CAB', ...common(), people: 2, ...over });

const poolIn = (a: Agent, body: object) => a.post('/api/pools').send(body);

const counts = async () => ({
  owner: await CarOwnerPool.countDocuments(),
  cab: await CabPool.countDocuments(),
});

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  matcher.calls = [];
  matcher.matches = [];
});

describe('POST /api/pools: authentication', () => {
  it('requires login', async () => {
    expect((await request(app).post('/api/pools').send(ownVehicle())).status).toBe(401);
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });
});

describe('POST /api/pools: "I own the vehicle" -> car-owner section', () => {
  it('saves a car-owner pool and nothing in the cab section', async () => {
    const user = await signUp();
    const res = await poolIn(user, ownVehicle());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ outcome: 'POOL_CREATED', section: 'CAR_OWNER' });
    expect(res.body.data.pool).toMatchObject({
      section: 'CAR_OWNER',
      origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
      destination: { label: 'Kempegowda Airport' },
      luggage: { large: 1, medium: 0, cabin: 1, backpack: 2, oversized: 0 },
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seats: { offered: 3, available: 3, taken: 0 },
      pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true },
      status: 'OPEN',
    });
    expect(await counts()).toEqual({ owner: 1, cab: 0 });

    const userId = (await User.findOne({ email: 'rider@example.com' }))!.id;
    const stored = await CarOwnerPool.findById(res.body.data.pool.id);
    expect(stored!.userId.toString()).toBe(userId);
    expect(stored!.arriveBy).toBeInstanceOf(Date);
  });

  it('does not search for matches (that is only for cab requests)', async () => {
    const user = await signUp();
    await poolIn(user, ownVehicle());
    expect(matcher.calls).toHaveLength(0);
  });

  it('stores a fixed fare when not negotiable, and defaults to fixed and zero luggage', async () => {
    const user = await signUp();
    const { negotiable: _n, luggage: _l, ...bare } = ownVehicle();
    const res = await poolIn(user, bare);
    expect(res.status).toBe(201);
    expect(res.body.data.pool.pricing.negotiable).toBe(false);
    expect(res.body.data.pool.luggage).toEqual({ large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 });
  });

  it('ignores server-controlled fields sent by the client', async () => {
    const user = await signUp();
    const other = await signUp('other@example.com', '9123456780');
    const otherId = (await other.get('/api/auth/me')).body.data.user.id;
    const res = await poolIn(user, ownVehicle({ userId: otherId, availableSeats: 99, status: 'COMPLETED', currentPassengerCount: 5 }));

    expect(res.status).toBe(201);
    expect(res.body.data.pool).toMatchObject({ status: 'OPEN', seats: { available: 3, taken: 0 } });
    const me = (await user.get('/api/auth/me')).body.data.user.id;
    expect((await CarOwnerPool.findById(res.body.data.pool.id))!.userId.toString()).toBe(me);
  });

  it('enforces seats against the vehicle type', async () => {
    const user = await signUp();
    const tooMany = await poolIn(user, ownVehicle({ seats: 5 }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details.map((d: { path: string }) => d.path)).toContain('seats');

    for (const [i, [category, seats]] of ([['HATCHBACK', 4], ['SUV', 6], ['MUV', 7], ['OTHER', 8]] as const).entries()) {
      const res = await poolIn(
        user,
        ownVehicle({ vehicle: { category, make: 'Make', model: 'Model' }, seats, destination: { label: `Place ${i}` } }),
      );
      expect(res.status).toBe(201);
    }
  });
});

describe('POST /api/pools: "Pool a cab" -> search both sections, else cab section', () => {
  it('searches first, then saves a request in the cab section only', async () => {
    const user = await signUp();
    const res = await poolIn(user, poolCab());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ outcome: 'REQUEST_CREATED', section: 'CAB' });
    expect(res.body.data.pool).toMatchObject({
      section: 'CAB',
      people: 2,
      status: 'OPEN',
      luggage: { large: 1, medium: 0, cabin: 1, backpack: 2, oversized: 0 },
    });
    expect(await counts()).toEqual({ owner: 0, cab: 1 });

    expect(matcher.calls).toHaveLength(1);
    expect(matcher.calls[0]).toMatchObject({
      origin: { label: 'Indiranagar, Bengaluru' },
      destination: { label: 'Kempegowda Airport' },
      people: 2,
      luggage: { large: 1, cabin: 1, backpack: 2 },
    });
    expect(matcher.calls[0]!.arriveBy).toBeInstanceOf(Date);
  });

  it('reports that both sections are covered by the search', async () => {
    const user = await signUp();
    const res = await poolIn(user, poolCab());
    expect(res.body.data.matching.sections).toEqual(['CAR_OWNER', 'CAB']);
  });

  it('creates nothing when a match is found, and returns the matches instead', async () => {
    matcher.matches = [{ id: 'abc123', section: 'CAR_OWNER' }];
    const user = await signUp();
    const res = await poolIn(user, poolCab());

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('MATCHES_FOUND');
    expect(res.body.data.matching.matches).toEqual([{ id: 'abc123', section: 'CAR_OWNER' }]);
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });

  it('with the real placeholder matcher, says matching is not available yet but still saves the request', async () => {
    const real = makeApp(); // default UnimplementedMatcher
    const user = await signUp('real@example.com', '9000000002', real);
    const res = await poolIn(user, poolCab());

    expect(res.status).toBe(201);
    expect(res.body.data.matching).toEqual({ status: 'NOT_AVAILABLE', sections: ['CAR_OWNER', 'CAB'], matches: [] });
    expect(res.body.data.outcome).toBe('REQUEST_CREATED');
  });

  it.each([
    ['zero people', { people: 0 }],
    ['fractional people', { people: 1.5 }],
    ['more than the maximum', { people: POOL_POLICY.MAX_PEOPLE + 1 }],
    ['missing people', { people: undefined }],
  ])('rejects %s', async (_label, override) => {
    const user = await signUp();
    const res = await poolIn(user, poolCab(override));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('people');
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });

  it('ignores vehicle fields (cab requests have no vehicle)', async () => {
    const user = await signUp();
    const res = await poolIn(user, poolCab({ vehicle: { category: 'SEDAN', make: 'X', model: 'Y' }, seats: 3, askingPrice: 10 }));
    expect(res.status).toBe(201);
    expect(res.body.data.pool).not.toHaveProperty('vehicle');
    expect(res.body.data.pool).not.toHaveProperty('pricing');
  });
});

describe('POST /api/pools: shared validation', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['an empty start', { origin: { label: ' ' } }, 'origin.label'],
    ['an empty destination', { destination: { label: '' } }, 'destination.label'],
    ['the same start and destination', { destination: { label: 'indiranagar,  bengaluru' } }, 'destination.label'],
    ['start and destination at the same spot', { destination: { label: 'Elsewhere', coordinates: { lat: 12.9785, lng: 77.6409 } } }, 'destination.label'],
    ['a latitude out of range', { origin: { label: 'Nowhere', coordinates: { lat: 95, lng: 10 } } }, 'origin.coordinates.lat'],
    ['coordinates with only a latitude', { origin: { label: 'Nowhere', coordinates: { lat: 10 } } }, 'origin.coordinates.lng'],
    ['a missing arrival time', { arriveBy: undefined }, 'arriveBy'],
    ['a malformed arrival time', { arriveBy: 'tomorrow' }, 'arriveBy'],
    ['an arrival time in the past', { arriveBy: hoursFromNow(-2) }, 'arriveBy'],
    ['an arrival time too soon', { arriveBy: new Date(Date.now() + 60_000).toISOString() }, 'arriveBy'],
    ['an arrival time too far ahead', { arriveBy: hoursFromNow(24 * 120) }, 'arriveBy'],
    ['negative luggage', { luggage: { large: -1 } }, 'luggage.large'],
    ['fractional luggage', { luggage: { cabin: 1.5 } }, 'luggage.cabin'],
    ['too much luggage of one kind', { luggage: { backpack: POOL_POLICY.MAX_LUGGAGE_PER_TYPE + 1 } }, 'luggage.backpack'],
    ['luggage as text', { luggage: { large: 'two' } }, 'luggage.large'],
  ];

  it.each(cases)('rejects %s (own vehicle and cab)', async (_label, override, field) => {
    const user = await signUp();
    for (const body of [ownVehicle(override), poolCab(override)]) {
      const res = await poolIn(user, body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
    }
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });

  it.each([
    ['no mode', undefined],
    ['an unknown mode', 'TELEPORT'],
    ['a lowercase mode', 'own_vehicle'],
  ])('rejects %s', async (_label, mode) => {
    const user = await signUp();
    const res = await poolIn(user, { ...ownVehicle(), mode });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });

  it.each([
    ['negative fare', { askingPrice: -1 }, 'askingPrice'],
    ['fare with three decimals', { askingPrice: 10.123 }, 'askingPrice'],
    ['fare above the maximum', { askingPrice: POOL_POLICY.MAX_FARE + 1 }, 'askingPrice'],
    ['fare as text', { askingPrice: '250' }, 'askingPrice'],
    ['unknown vehicle type', { vehicle: { category: 'SPACESHIP', make: 'X', model: 'Y' } }, 'vehicle.category'],
    ['missing vehicle make', { vehicle: { category: 'SEDAN', make: '', model: 'City' } }, 'vehicle.make'],
    ['zero seats', { seats: 0 }, 'seats'],
  ])('rejects an own-vehicle pool with %s', async (_label, override, field) => {
    const user = await signUp();
    const res = await poolIn(user, ownVehicle(override));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
  });

  it('accepts a destination without coordinates (place search was down)', async () => {
    const user = await signUp();
    const res = await poolIn(user, ownVehicle({ destination: { label: 'Typed place' } }));
    expect(res.status).toBe(201);
    expect(res.body.data.pool.destination.coordinates).toBeUndefined();
  });
});

describe('duplicates and limits', () => {
  it('rejects an accidental duplicate in the same section, even at the same moment', async () => {
    const user = await signUp();
    const results = await Promise.all([poolIn(user, ownVehicle()), poolIn(user, ownVehicle()), poolIn(user, ownVehicle())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('DUPLICATE_POOL');
    expect((await counts()).owner).toBe(1);

    const cabs = await Promise.all([poolIn(user, poolCab()), poolIn(user, poolCab())]);
    expect(cabs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await counts()).cab).toBe(1);
  });

  it('allows the same trip once as an owner and once as a cab rider', async () => {
    const user = await signUp();
    expect((await poolIn(user, ownVehicle())).status).toBe(201);
    expect((await poolIn(user, poolCab())).status).toBe(201);
    expect(await counts()).toEqual({ owner: 1, cab: 1 });
  });

  it('allows the same route at a different arrival time', async () => {
    const user = await signUp();
    expect((await poolIn(user, ownVehicle({ arriveBy: hoursFromNow(48) }))).status).toBe(201);
    expect((await poolIn(user, ownVehicle({ arriveBy: hoursFromNow(72) }))).status).toBe(201);
  });

  it('caps active pools per section', async () => {
    const user = await signUp();
    for (let i = 0; i < POOL_POLICY.MAX_ACTIVE_PER_USER; i++) {
      expect((await poolIn(user, poolCab({ destination: { label: `Destination ${i}` } }))).status).toBe(201);
    }
    const res = await poolIn(user, poolCab({ destination: { label: 'One too many' } }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_ACTIVE_POOLS');

    // The other section has its own allowance.
    expect((await poolIn(user, ownVehicle())).status).toBe(201);
  });

  it('does not count cancelled pools, and lets a cancelled route be listed again', async () => {
    const user = await signUp();
    const first = await poolIn(user, ownVehicle());
    await CarOwnerPool.updateOne({ _id: first.body.data.pool.id }, { status: 'CANCELLED' });
    expect((await poolIn(user, ownVehicle())).status).toBe(201);
  });

  it('is rate limited', async () => {
    const limited = makeApp({ rateLimitEnabled: true });
    const user = await signUp('rl@example.com', '9000000001', limited);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await user.post('/api/pools').send({})).status;
    expect(last).toBe(429);
  });
});

describe('verified-phone policy', () => {
  const strict = makeApp({ config: { REQUIRE_VERIFIED_PHONE_FOR_BOOKING: true } });

  it('is off by default: an unverified user can pool in', async () => {
    const user = await signUp();
    expect((await poolIn(user, ownVehicle())).status).toBe(201);
  });

  it('blocks unverified users in both modes when the policy is on', async () => {
    const user = await signUp('strict@example.com', '9111111111', strict);
    for (const body of [ownVehicle(), poolCab()]) {
      const res = await poolIn(user, body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PHONE_NOT_VERIFIED');
    }
    expect(await counts()).toEqual({ owner: 0, cab: 0 });
  });

  it('allows verified users when the policy is on', async () => {
    const user = await signUp('strict@example.com', '9111111111', strict);
    await User.updateOne({ email: 'strict@example.com' }, { phoneVerifiedAt: new Date() });
    expect((await poolIn(user, ownVehicle())).status).toBe(201);
  });
});

describe('GET /api/pools/mine and /api/pools/:id', () => {
  it('require login', async () => {
    expect((await request(app).get('/api/pools/mine')).status).toBe(401);
    expect((await request(app).get('/api/pools/507f1f77bcf86cd799439011')).status).toBe(401);
  });

  it('lists the user\'s pools from both sections, newest first, and no one else\'s', async () => {
    const a = await signUp('a@example.com', '9876543210');
    const b = await signUp('b@example.com', '9123456780');
    await poolIn(a, ownVehicle({ destination: { label: 'First (owner)' } }));
    await poolIn(a, poolCab({ destination: { label: 'Second (cab)' } }));
    await poolIn(a, ownVehicle({ destination: { label: 'Third (owner)' } }));
    await poolIn(b, poolCab({ destination: { label: 'Not mine' } }));

    const res = await a.get('/api/pools/mine');
    expect(res.status).toBe(200);
    expect(res.body.data.pools.map((p: { destination: { label: string }; section: string }) => [p.destination.label, p.section])).toEqual([
      ['Third (owner)', 'CAR_OWNER'],
      ['Second (cab)', 'CAB'],
      ['First (owner)', 'CAR_OWNER'],
    ]);
  });

  it('returns an empty list when there are none', async () => {
    const user = await signUp();
    expect((await user.get('/api/pools/mine')).body.data.pools).toEqual([]);
  });

  it('returns one pool whichever section it is in', async () => {
    const user = await signUp();
    const ownerId = (await poolIn(user, ownVehicle())).body.data.pool.id;
    const cabId = (await poolIn(user, poolCab())).body.data.pool.id;

    expect((await user.get(`/api/pools/${ownerId}`)).body.data.pool).toMatchObject({ id: ownerId, section: 'CAR_OWNER' });
    expect((await user.get(`/api/pools/${cabId}`)).body.data.pool).toMatchObject({ id: cabId, section: 'CAB' });
  });

  it('answers 404 for another user\'s pool and for malformed or unknown ids, so ids cannot be probed', async () => {
    const owner = await signUp('a@example.com', '9876543210');
    const stranger = await signUp('b@example.com', '9123456780');
    const id = (await poolIn(owner, ownVehicle())).body.data.pool.id;
    const cabId = (await poolIn(owner, poolCab())).body.data.pool.id;

    expect((await stranger.get(`/api/pools/${id}`)).status).toBe(404);
    expect((await stranger.get(`/api/pools/${cabId}`)).status).toBe(404);
    expect((await owner.get('/api/pools/not-an-id')).status).toBe(404);
    expect((await owner.get('/api/pools/507f1f77bcf86cd799439011')).status).toBe(404);
  });
});
