import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { RIDE_POLICY } from '../src/config/rides.js';
import { Ride } from '../src/models/Ride.js';
import { User } from '../src/models/User.js';
import { distanceMetres } from '../src/utils/geo.js';
import { clearDb, makeApp, startTestDb, stopTestDb } from './helpers.js';

const app = makeApp();
type Agent = ReturnType<typeof request.agent>;

async function signUp(email = 'owner@example.com', phone = '9876543210', application = app) {
  const agent = request.agent(application);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: 'Owner One', email, phone, password: 'Passw0rdOK' });
  expect(res.status).toBe(201);
  return agent;
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const validRide = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
  destination: { label: 'Kempegowda Airport' },
  departureAt: hoursFromNow(48),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: true,
  ...over,
});

const create = (a: Agent, body: object = validRide()) => a.post('/api/rides').send(body);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('POST /api/rides', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/rides').send(validRide());
    expect(res.status).toBe(401);
  });

  it('creates an open pool owned by the signed-in user', async () => {
    const owner = await signUp();
    const res = await create(owner);

    expect(res.status).toBe(201);
    expect(res.body.data.ride).toMatchObject({
      rideType: 'OWNER_VEHICLE',
      origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
      destination: { label: 'Kempegowda Airport' },
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seats: { offered: 3, available: 3, taken: 0 },
      pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true },
      status: 'OPEN',
    });

    const stored = await Ride.findById(res.body.data.ride.id);
    const user = await User.findOne({ email: 'owner@example.com' });
    expect(stored!.ownerUserId.toString()).toBe(user!.id);
    expect(stored!.pricingMode).toBe('NEGOTIABLE');
  });

  it('stores a fixed fare when the negotiable box is unticked, and defaults to fixed', async () => {
    const owner = await signUp();
    expect((await create(owner, validRide({ negotiable: false }))).body.data.ride.pricing.negotiable).toBe(false);

    const { negotiable: _n, ...rest } = validRide({ destination: { label: 'Whitefield' } });
    const res = await create(owner, rest);
    expect(res.status).toBe(201);
    expect(res.body.data.ride.pricing.negotiable).toBe(false);
  });

  it('accepts a destination without coordinates (no place search yet) and a free ride', async () => {
    const owner = await signUp();
    const res = await create(owner, validRide({ askingPrice: 0 }));
    expect(res.status).toBe(201);
    expect(res.body.data.ride.destination.coordinates).toBeUndefined();
    expect(res.body.data.ride.pricing.amount).toBe(0);
  });

  it('ignores server-controlled fields sent by the client', async () => {
    const owner = await signUp();
    const other = await signUp('other@example.com', '9123456780');
    const otherId = (await other.get('/api/auth/me')).body.data.user.id;

    const res = await create(
      owner,
      validRide({ ownerUserId: otherId, availableSeats: 99, rideStatus: 'COMPLETED', rideType: 'BOOKED_CAB', currentPassengerCount: 5 }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.ride).toMatchObject({ rideType: 'OWNER_VEHICLE', status: 'OPEN', seats: { available: 3, taken: 0 } });
    const ownerId = (await owner.get('/api/auth/me')).body.data.user.id;
    expect((await Ride.findById(res.body.data.ride.id))!.ownerUserId.toString()).toBe(ownerId);
  });

  it('trims whitespace in text fields', async () => {
    const owner = await signUp();
    const res = await create(owner, validRide({ vehicle: { category: 'SUV', make: '  Toyota ', model: ' Innova  ' } }));
    expect(res.body.data.ride.vehicle).toMatchObject({ make: 'Toyota', model: 'Innova' });
  });

  describe('validation', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['zero seats', { seats: 0 }, 'seats'],
      ['fractional seats', { seats: 2.5 }, 'seats'],
      ['more seats than a sedan holds', { seats: 5 }, 'seats'],
      ['more seats than a hatchback holds', { vehicle: { category: 'HATCHBACK', make: 'Maruti', model: 'Swift' }, seats: 5 }, 'seats'],
      ['negative fare', { askingPrice: -1 }, 'askingPrice'],
      ['fare with three decimals', { askingPrice: 10.123 }, 'askingPrice'],
      ['fare above the maximum', { askingPrice: RIDE_POLICY.MAX_FARE + 1 }, 'askingPrice'],
      ['fare as text', { askingPrice: '250' }, 'askingPrice'],
      ['missing fare', { askingPrice: undefined }, 'askingPrice'],
      ['unknown vehicle type', { vehicle: { category: 'SPACESHIP', make: 'X', model: 'Y' } }, 'vehicle.category'],
      ['missing vehicle make', { vehicle: { category: 'SEDAN', make: '', model: 'City' } }, 'vehicle.make'],
      ['missing vehicle model', { vehicle: { category: 'SEDAN', make: 'Honda', model: ' ' } }, 'vehicle.model'],
      ['empty start', { origin: { label: ' ' } }, 'origin.label'],
      ['empty destination', { destination: { label: '' } }, 'destination.label'],
      ['same start and destination', { destination: { label: 'indiranagar,  bengaluru' } }, 'destination.label'],
      ['start and destination at the same spot', { destination: { label: 'Elsewhere', coordinates: { lat: 12.9785, lng: 77.6409 } } }, 'destination.label'],
      ['latitude out of range', { origin: { label: 'Nowhere', coordinates: { lat: 95, lng: 10 } } }, 'origin.coordinates.lat'],
      ['coordinates with only a latitude', { origin: { label: 'Nowhere', coordinates: { lat: 10 } } }, 'origin.coordinates.lng'],
      ['malformed departure (when sent)', { departureAt: 'tomorrow' }, 'departureAt'],
      ['departure in the past', { departureAt: hoursFromNow(-2) }, 'departureAt'],
      ['departure too soon', { departureAt: new Date(Date.now() + 60_000).toISOString() }, 'departureAt'],
      ['departure too far ahead', { departureAt: hoursFromNow(24 * 120) }, 'departureAt'],
    ];

    it.each(cases)('rejects %s', async (_label, override, field) => {
      const owner = await signUp();
      const res = await create(owner, validRide(override));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
      expect(await Ride.countDocuments()).toBe(0);
    });

    it('allows the maximum seats for each vehicle type', async () => {
      const owner = await signUp();
      const cases = [
        ['HATCHBACK', 4],
        ['SUV', 6],
        ['MUV', 7],
        ['OTHER', 8],
      ] as const;
      for (const [i, [category, seats]] of cases.entries()) {
        const res = await create(
          owner,
          validRide({ vehicle: { category, make: 'Make', model: 'Model' }, seats, destination: { label: `Place ${i}` } }),
        );
        expect(res.status).toBe(201);
      }
    });
  });

  it('rejects an accidental duplicate listing, even when sent at the same moment', async () => {
    const owner = await signUp();
    const body = validRide();
    const results = await Promise.all([create(owner, body), create(owner, body), create(owner, body)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('DUPLICATE_RIDE');
    expect(await Ride.countDocuments()).toBe(1);
  });

  it('allows the same route at a different time', async () => {
    const owner = await signUp();
    expect((await create(owner, validRide({ departureAt: hoursFromNow(48) }))).status).toBe(201);
    expect((await create(owner, validRide({ departureAt: hoursFromNow(72) }))).status).toBe(201);
  });

  it('caps the number of active pools per owner', async () => {
    const owner = await signUp();
    for (let i = 0; i < RIDE_POLICY.MAX_ACTIVE_PER_OWNER; i++) {
      expect((await create(owner, validRide({ destination: { label: `Destination ${i}` } }))).status).toBe(201);
    }
    const res = await create(owner, validRide({ destination: { label: 'One too many' } }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TOO_MANY_ACTIVE_RIDES');
  });

  it('does not count cancelled pools towards the cap, and lets a cancelled route be listed again', async () => {
    const owner = await signUp();
    const first = await create(owner);
    await Ride.updateOne({ _id: first.body.data.ride.id }, { rideStatus: 'CANCELLED' });
    expect((await create(owner)).status).toBe(201);
  });

  it('is rate limited', async () => {
    const limited = makeApp({ rateLimitEnabled: true });
    const owner = await signUp('rl@example.com', '9000000001', limited);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await owner.post('/api/rides').send({})).status;
    expect(last).toBe(429);
  });
});

describe('verified-phone policy on creating a pool', () => {
  const strict = makeApp({ config: { REQUIRE_VERIFIED_PHONE_FOR_BOOKING: true } });

  it('is off by default: an unverified owner can list a pool', async () => {
    const owner = await signUp();
    expect((await create(owner)).status).toBe(201);
  });

  it('blocks unverified owners when the policy is on', async () => {
    const owner = await signUp('strict@example.com', '9111111111', strict);
    const res = await create(owner);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(await Ride.countDocuments()).toBe(0);
  });

  it('allows verified owners when the policy is on', async () => {
    const owner = await signUp('strict@example.com', '9111111111', strict);
    await User.updateOne({ email: 'strict@example.com' }, { phoneVerifiedAt: new Date() });
    expect((await create(owner)).status).toBe(201);
  });
});

describe('GET /api/rides/mine and /api/rides/:id', () => {
  it('require authentication', async () => {
    expect((await request(app).get('/api/rides/mine')).status).toBe(401);
    expect((await request(app).get('/api/rides/507f1f77bcf86cd799439011')).status).toBe(401);
  });

  it('lists only the signed-in user\'s pools, newest first', async () => {
    const a = await signUp('a@example.com', '9876543210');
    const b = await signUp('b@example.com', '9123456780');
    await create(a, validRide({ destination: { label: 'Soon' }, departureAt: hoursFromNow(30) }));
    await create(a, validRide({ destination: { label: 'Later' }, departureAt: hoursFromNow(90) }));
    await create(b, validRide({ destination: { label: 'Not mine' } }));

    const res = await a.get('/api/rides/mine');
    expect(res.status).toBe(200);
    expect(res.body.data.rides.map((r: { destination: { label: string } }) => r.destination.label)).toEqual(['Later', 'Soon']);
  });

  it('returns an empty list for a user with no pools', async () => {
    const owner = await signUp();
    const res = await owner.get('/api/rides/mine');
    expect(res.body.data.rides).toEqual([]);
  });

  it('returns one of the owner\'s pools', async () => {
    const owner = await signUp();
    const id = (await create(owner)).body.data.ride.id;
    const res = await owner.get(`/api/rides/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ride.id).toBe(id);
  });

  it('answers 404 for another user\'s pool and for malformed ids, so ids cannot be probed', async () => {
    const owner = await signUp('a@example.com', '9876543210');
    const stranger = await signUp('b@example.com', '9123456780');
    const id = (await create(owner)).body.data.ride.id;

    expect((await stranger.get(`/api/rides/${id}`)).status).toBe(404);
    expect((await owner.get('/api/rides/not-an-id')).status).toBe(404);
    expect((await owner.get('/api/rides/507f1f77bcf86cd799439011')).status).toBe(404);
  });
});

describe('pools without a departure time', () => {
  const { departureAt: _drop, ...noTime } = validRide();

  it('can be created, and report a null departure', async () => {
    const owner = await signUp();
    const res = await create(owner, noTime);

    expect(res.status).toBe(201);
    expect(res.body.data.ride.departureAt).toBeNull();
    expect(res.body.data.ride.status).toBe('OPEN');
    const stored = await Ride.findById(res.body.data.ride.id);
    expect(stored!.departureAt).toBeUndefined();
  });

  it('still validates a departure when one is sent', async () => {
    const owner = await signUp();
    const res = await create(owner, validRide({ departureAt: hoursFromNow(-2) }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('departureAt');
  });

  it('rejects the same route twice, even at the same moment, but allows other routes', async () => {
    const owner = await signUp();
    const results = await Promise.all([create(owner, noTime), create(owner, noTime)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('DUPLICATE_RIDE');

    expect((await create(owner, { ...noTime, destination: { label: 'Whitefield' } })).status).toBe(201);
  });

  it('can sit alongside a timed pool on the same route', async () => {
    const owner = await signUp();
    expect((await create(owner, validRide())).status).toBe(201);
    expect((await create(owner, noTime)).status).toBe(201);
  });

  it('are listed newest first together with timed pools', async () => {
    const owner = await signUp();
    await create(owner, { ...noTime, destination: { label: 'First' } });
    await create(owner, validRide({ destination: { label: 'Second' } }));
    await create(owner, { ...noTime, destination: { label: 'Third' } });

    const res = await owner.get('/api/rides/mine');
    expect(res.body.data.rides.map((r: { destination: { label: string } }) => r.destination.label)).toEqual(['Third', 'Second', 'First']);
    expect(res.body.data.rides[0].departureAt).toBeNull();
    expect(res.body.data.rides[1].departureAt).not.toBeNull();
  });
});

describe('distanceMetres', () => {
  it('is zero for the same point and roughly right for a known pair', () => {
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(0);
    // Bengaluru to Mysuru is about 125 km as the crow flies.
    const km = distanceMetres({ lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 }) / 1000;
    expect(km).toBeGreaterThan(120);
    expect(km).toBeLessThan(135);
  });
});
