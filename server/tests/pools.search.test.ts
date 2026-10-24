import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MATCHING } from '../src/config/matching.js';
import { CabPool } from '../src/models/CabPool.js';
import { CarOwnerPool } from '../src/models/CarOwnerPool.js';
import { onOwnerPoolPublished } from '../src/services/pools/searchService.js';
import type { PassengerMatch } from '../src/services/matching/types.js';
import { clearDb, fakeOwnerMatch, FakeMatcher, makeApp, RecordingNotifier, startTestDb, stopTestDb } from './helpers.js';

const matcher = new FakeMatcher();
const notifier = new RecordingNotifier();
const app = makeApp({ matcher, notifier });
type Agent = ReturnType<typeof request.agent>;

let n = 0;
async function signUp(label = 'rider') {
  n += 1;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: 'Rider One', email: `${label}${n}@example.com`, phone: `98${String(10000000 + n)}`, password: 'Passw0rdOK' });
  expect(res.status).toBe(201);
  return { agent, id: res.body.data.user.id as string };
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const trip = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Indiranagar, Bengaluru', coordinates: { lat: 12.9784, lng: 77.6408 } },
  destination: { label: 'Kempegowda Airport', coordinates: { lat: 13.1986, lng: 77.7066 } },
  arriveBy: hoursFromNow(48),
  luggage: { large: 0, medium: 0, cabin: 1, backpack: 0, oversized: 0 },
  ...over,
});
const poolCab = (over: Record<string, unknown> = {}) => ({ mode: 'POOL_CAB', ...trip(), people: 2, ...over });
const ownVehicle = (over: Record<string, unknown> = {}) => ({
  mode: 'OWN_VEHICLE',
  ...trip(),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: false,
  ...over,
});

const startSearch = async (agent: Agent, over: Record<string, unknown> = {}) => {
  const res = await agent.post('/api/pools').send(poolCab(over));
  expect(res.body.data.outcome).toBe('SEARCH_STARTED');
  return res.body.data.pool.id as string;
};
const publishPool = async (agent: Agent, over: Record<string, unknown> = {}) => {
  const res = await agent.post('/api/pools').send(ownVehicle(over));
  expect(res.status).toBe(201);
  return res.body.data.pool.id as string;
};
const expireSearch = (id: string) => CabPool.updateOne({ _id: id }, { searchExpiresAt: new Date(Date.now() - 1000) });

const fakeGroup = (requestId: string): PassengerMatch => ({
  section: 'CAB',
  requestId,
  score: 72,
  breakdown: [],
  reasons: ['A group of 3 fits in one cab.'],
  otherPeople: 1,
  groupSize: 3,
  pickup: { lat: 12.98, lng: 77.64, roadKmForYou: 0.4 },
  dropoff: { lat: 13.19, lng: 77.7, roadKmForYou: 0.3 },
  rideKm: 24,
  rideMinutes: 41,
  note: 'A proposed group, not a confirmed ride. There is no driver or vehicle yet, and nothing is booked until everyone accepts.',
  evaluatedAt: new Date().toISOString(),
});

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  Object.assign(matcher, { ownerCalls: [], peerCalls: [], poolChecks: [], nearbyCalls: [], nearby: [], ownerMatches: [], groups: [], ownerStatus: 'OK', poolResult: null });
  notifier.sent = [];
});

describe('GET /api/pools/:id/search', () => {
  it('needs login, and is private to the person who searched', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await startSearch(a.agent);

    expect((await request(app).get(`/api/pools/${id}/search`)).status).toBe(401);
    expect((await b.agent.get(`/api/pools/${id}/search`)).status).toBe(404);
    expect((await a.agent.get('/api/pools/not-an-id/search')).status).toBe(404);
    expect((await a.agent.get('/api/pools/507f1f77bcf86cd799439011/search')).status).toBe(404);
  });

  it('reports a running five-minute search', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;

    expect(search).toMatchObject({ id, status: 'SEARCHING', windowSeconds: 300, matches: [], nearest: [], groups: [], postedForOthers: false });
    expect(search.remainingSeconds).toBeLessThanOrEqual(300);
    expect(search.remainingSeconds).toBeGreaterThan(290);
    expect(search.matching.status).toBe('OK');
  });

  it('keeps looking, but only at pools published since the last check, never the whole database', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    const firstChecked = (await CabPool.findById(id))!.searchCheckedAt!;

    await new Promise((r) => setTimeout(r, 15));
    await agent.get(`/api/pools/${id}/search`);

    const poll = matcher.ownerCalls.at(-1)!;
    expect(poll.opts?.createdAfter).toEqual(firstChecked);
    expect((await CabPool.findById(id))!.searchCheckedAt!.getTime()).toBeGreaterThan(firstChecked.getTime());

    // and the next poll starts from the new mark
    const second = (await CabPool.findById(id))!.searchCheckedAt!;
    await new Promise((r) => setTimeout(r, 15));
    await agent.get(`/api/pools/${id}/search`);
    expect(matcher.ownerCalls.at(-1)!.opts?.createdAfter).toEqual(second);
  });

  it('does not move the "already checked" mark when some pools could not be checked, so they are retried', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    const before = (await CabPool.findById(id))!.searchCheckedAt!;

    matcher.ownerStatus = 'DEGRADED';
    await new Promise((r) => setTimeout(r, 15));
    const res = await agent.get(`/api/pools/${id}/search`);

    expect(res.body.data.search.matching.status).toBe('DEGRADED');
    expect((await CabPool.findById(id))!.searchCheckedAt).toEqual(before);
  });

  it('starts from the beginning of the window when the first check was degraded', async () => {
    matcher.ownerStatus = 'DEGRADED';
    const { agent } = await signUp();
    const id = await startSearch(agent);
    matcher.ownerStatus = 'OK';
    await agent.get(`/api/pools/${id}/search`);
    expect(matcher.ownerCalls.at(-1)!.opts?.createdAfter).toBeUndefined();
  });

  it('shows newly found matches best first, merged with earlier ones and saved', async () => {
    const owner = await signUp('owner');
    const { agent } = await signUp();
    const poolA = await publishPool(owner.agent);
    const poolB = await publishPool(owner.agent, { destination: { label: 'Whitefield', coordinates: { lat: 12.97, lng: 77.75 } } });
    const id = await startSearch(agent);

    matcher.ownerMatches = [fakeOwnerMatch(poolA, 70)];
    let search = (await agent.get(`/api/pools/${id}/search`)).body.data.search;
    expect(search.matches.map((m: { poolId: string }) => m.poolId)).toEqual([poolA]);

    matcher.ownerMatches = [fakeOwnerMatch(poolB, 90)]; // only the newly published pool is returned on later polls
    search = (await agent.get(`/api/pools/${id}/search`)).body.data.search;
    expect(search.matches.map((m: { poolId: string; score: number }) => [m.poolId, m.score])).toEqual([[poolB, 90], [poolA, 70]]);

    expect(((await CabPool.findById(id))!.matches as unknown[]).length).toBe(2);
  });

  it('replaces an older result for the same pool instead of listing it twice', async () => {
    const owner = await signUp('owner');
    const { agent } = await signUp();
    const pool = await publishPool(owner.agent);
    const id = await startSearch(agent);

    matcher.ownerMatches = [fakeOwnerMatch(pool, 60)];
    await agent.get(`/api/pools/${id}/search`);
    matcher.ownerMatches = [fakeOwnerMatch(pool, 85)];
    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;

    expect(search.matches).toHaveLength(1);
    expect(search.matches[0].score).toBe(85);
  });

  it('drops a match whose pool has since filled up, been cancelled, or lost seats', async () => {
    const owner = await signUp('owner');
    const { agent } = await signUp();
    const full = await publishPool(owner.agent);
    const cancelled = await publishPool(owner.agent, { destination: { label: 'Place B' } });
    const fewSeats = await publishPool(owner.agent, { destination: { label: 'Place C' } });
    const fine = await publishPool(owner.agent, { destination: { label: 'Place D' } });
    const id = await startSearch(agent, { people: 2 });

    matcher.ownerMatches = [fakeOwnerMatch(full, 90), fakeOwnerMatch(cancelled, 88), fakeOwnerMatch(fewSeats, 86), fakeOwnerMatch(fine, 80)];
    await agent.get(`/api/pools/${id}/search`);

    await CarOwnerPool.updateOne({ _id: full }, { status: 'FULL', availableSeats: 0 });
    await CarOwnerPool.updateOne({ _id: cancelled }, { status: 'CANCELLED' });
    await CarOwnerPool.updateOne({ _id: fewSeats }, { availableSeats: 1 }); // the passenger needs 2
    await CarOwnerPool.updateOne({ _id: fine }, { availableSeats: 2, status: 'PARTIALLY_FILLED' });

    matcher.ownerMatches = [];
    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.matches.map((m: { poolId: string }) => m.poolId)).toEqual([fine]);
    expect(search.matches[0].seatsAvailable).toBe(2); // refreshed from the live record
  });

  it('ends after five minutes with no pool: the request is posted open for other passengers', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    await expireSearch(id);

    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search).toMatchObject({ status: 'OPEN', remainingSeconds: 0, postedForOthers: true });
    expect((await CabPool.findById(id))!.status).toBe('OPEN');
    // From now on it is an open request, so another passenger's matching can find it.
    expect(matcher.ownerCalls.at(-1)!.opts?.createdAfter).toBeUndefined(); // owner pools are checked in full, not incrementally
  });

  it('when nothing fits, also returns the closest pools that do not, and never as matches', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    matcher.nearby = [
      {
        poolId: 'near-1',
        route: { from: 'Whitefield', to: 'Airport' },
        vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
        seatsAvailable: 3,
        fare: { amount: 250, negotiable: false },
        arriveBy: hoursFromNow(48),
        startGapKm: 4,
        endGapKm: 0.2,
        why: ['Its route passes about 4 km from your start, but you only want to travel 2 km to be picked up.'],
      },
    ];

    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.matches).toEqual([]);
    expect(search.nearest).toHaveLength(1);
    expect(search.nearest[0]).toMatchObject({ poolId: 'near-1', startGapKm: 4 });
  });

  it('does not look for near misses when a pool really fits', async () => {
    const owner = await signUp('owner');
    const { agent } = await signUp();
    const pool = await publishPool(owner.agent);
    const id = await startSearch(agent);
    matcher.ownerMatches = [fakeOwnerMatch(pool, 80)];
    matcher.nearbyCalls = [];

    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.matches).toHaveLength(1);
    expect(search.nearest).toEqual([]);
    expect(matcher.nearbyCalls).toHaveLength(0);
  });

  it('shows other passengers whose open requests could share a cab, as proposed groups', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    matcher.groups = [fakeGroup('someone-else')];

    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.groups).toHaveLength(1);
    expect(search.groups[0]).toMatchObject({ requestId: 'someone-else' });
    expect(search.groups[0].note).toMatch(/not a confirmed ride/i);
    expect(matcher.peerCalls.at(-1)).toMatchObject({ id }); // never matched with itself
  });

  it('keeps showing matches found before the end, while their pool is still available', async () => {
    const owner = await signUp('owner');
    const { agent } = await signUp();
    const pool = await publishPool(owner.agent);
    const id = await startSearch(agent);
    matcher.ownerMatches = [fakeOwnerMatch(pool, 77)];
    await agent.get(`/api/pools/${id}/search`);

    await expireSearch(id);
    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.status).toBe('OPEN');
    expect(search.matches.map((m: { poolId: string }) => m.poolId)).toEqual([pool]);
  });
});

describe('a search that has ended shows in My pools, and does not block a new one', () => {
  it('lists the ended search as an open request', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    await expireSearch(id);

    const mine = (await agent.get('/api/pools/mine')).body.data.pools;
    expect(mine.find((p: { id: string }) => p.id === id).status).toBe('OPEN');
  });

  it('the same search cannot be started twice, even after it ended and was posted; cancelling it frees it', async () => {
    const { agent } = await signUp();
    const body = poolCab();
    const first = await agent.post('/api/pools').send(body);
    expect(first.status).toBe(201);
    expect((await agent.post('/api/pools').send(body)).status).toBe(409);

    await CabPool.updateMany({}, { searchExpiresAt: new Date(Date.now() - 1000) });
    expect((await agent.post('/api/pools').send(body)).status).toBe(409); // already posted as an open request

    await agent.post(`/api/pools/${first.body.data.pool.id}/cancel-search`);
    expect((await agent.post('/api/pools').send(body)).status).toBe(201);
  });
});

describe('POST /api/pools/:id/cancel-search (edit the search, or stop it)', () => {
  it('stops a running search, and nothing more is searched', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);

    expect((await agent.post(`/api/pools/${id}/cancel-search`)).status).toBe(200);
    expect((await CabPool.findById(id))!.status).toBe('CANCELLED');

    const callsBefore = matcher.ownerCalls.length;
    const { search } = (await agent.get(`/api/pools/${id}/search`)).body.data;
    expect(search.status).toBe('CANCELLED');
    expect(matcher.ownerCalls).toHaveLength(callsBefore);
  });

  it('is allowed after the window ends too, and then the same trip can be searched again with changes', async () => {
    const { agent } = await signUp();
    const body = poolCab();
    const id = await startSearch(agent);
    await expireSearch(id);

    expect((await agent.post(`/api/pools/${id}/cancel-search`)).status).toBe(200);
    expect((await agent.post('/api/pools').send(body)).status).toBe(201);
  });

  it('cannot be done twice, by someone else, or for something that does not exist', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await startSearch(a.agent);

    expect((await b.agent.post(`/api/pools/${id}/cancel-search`)).status).toBe(404);
    expect((await a.agent.post(`/api/pools/${id}/cancel-search`)).status).toBe(200);
    const again = await a.agent.post(`/api/pools/${id}/cancel-search`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SEARCH_NOT_ACTIVE');
    expect((await a.agent.post('/api/pools/507f1f77bcf86cd799439011/cancel-search')).status).toBe(404);
    expect((await request(app).post(`/api/pools/${id}/cancel-search`)).status).toBe(401);
  });

  it('stops a cancelled search from receiving matches from newly published pools', async () => {
    const owner = await signUp('owner');
    const { agent, id: userId } = await signUp();
    const id = await startSearch(agent);
    await agent.post(`/api/pools/${id}/cancel-search`);

    matcher.poolResult = fakeOwnerMatch('x', 90);
    await publishPool(owner.agent);
    expect(matcher.poolChecks).toHaveLength(0);
    expect(notifier.sent.filter((s) => s.userId === userId)).toHaveLength(0);
  });
});

describe('POST /api/pools/:id/pooling-request (when the search ends with no car-owner pool)', () => {
  it('is refused while the search is still running', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);

    const res = await agent.post(`/api/pools/${id}/pooling-request`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEARCH_STILL_RUNNING');
    expect((await CabPool.findById(id))!.status).toBe('SEARCHING');
  });

  it('after the window, turns the search into an open passenger request and proposes groups', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    await expireSearch(id);
    matcher.groups = [fakeGroup('other-request')];

    const res = await agent.post(`/api/pools/${id}/pooling-request`);
    expect(res.status).toBe(200);
    expect(res.body.data.pool).toMatchObject({ id, status: 'OPEN', section: 'CAB' });
    expect(res.body.data.groups.matches[0].requestId).toBe('other-request');
    expect(res.body.data.groups.matches[0].note).toMatch(/not a confirmed ride/i);
    expect((await CabPool.findById(id))!.status).toBe('OPEN');

    // the request is passed to the matcher with its own id, so it is never matched with itself
    expect(matcher.peerCalls.at(-1)).toMatchObject({ id, people: 2 });
  });

  it('works when the user asks again later (the request is already open)', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    await expireSearch(id);
    await agent.post(`/api/pools/${id}/pooling-request`);

    expect((await agent.post(`/api/pools/${id}/pooling-request`)).status).toBe(200);
    expect((await CabPool.findById(id))!.status).toBe('OPEN');
  });

  it('is refused for a cancelled search, for someone else\'s, and for a missing one', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await startSearch(a.agent);
    await a.agent.post(`/api/pools/${id}/cancel-search`);

    expect((await a.agent.post(`/api/pools/${id}/pooling-request`)).status).toBe(409);
    expect((await b.agent.post(`/api/pools/${id}/pooling-request`)).status).toBe(404);
    expect((await a.agent.post('/api/pools/507f1f77bcf86cd799439011/pooling-request')).status).toBe(404);
    expect((await request(app).post(`/api/pools/${id}/pooling-request`)).status).toBe(401);
  });

  it('reports groups as unavailable when routing trouble stops them being checked, never as matches', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);
    await expireSearch(id);
    const original = matcher.findPassengerMatches.bind(matcher);
    matcher.findPassengerMatches = async (r) => ({ ...(await original(r)), status: 'DEGRADED', routingFailures: 2, matches: [] });

    const res = await agent.post(`/api/pools/${id}/pooling-request`);
    expect(res.body.data.groups).toMatchObject({ status: 'DEGRADED', matches: [] });
    matcher.findPassengerMatches = original;
  });
});

describe('GET /api/pools/:id/passenger-matches', () => {
  it('is only for an open passenger-pooling request', async () => {
    const { agent } = await signUp();
    const id = await startSearch(agent);

    const early = await agent.get(`/api/pools/${id}/passenger-matches`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_A_POOLING_REQUEST');
  });

  it('proposes groups for an open request, and is private to its owner', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await startSearch(a.agent);
    await expireSearch(id);
    await a.agent.post(`/api/pools/${id}/pooling-request`);
    matcher.groups = [fakeGroup('r-1'), fakeGroup('r-2')];

    const res = await a.agent.get(`/api/pools/${id}/passenger-matches`);
    expect(res.status).toBe(200);
    expect(res.body.data.groups.matches.map((g: { requestId: string }) => g.requestId)).toEqual(['r-1', 'r-2']);
    expect((await b.agent.get(`/api/pools/${id}/passenger-matches`)).status).toBe(404);
    expect((await request(app).get(`/api/pools/${id}/passenger-matches`)).status).toBe(401);
  });
});

describe('a newly published pool is checked against running searches (and only those)', () => {
  const deps = { matcher, notifier };

  async function setup() {
    const owner = await signUp('owner');
    const p1 = await signUp('p1');
    const p2 = await signUp('p2');
    const s1 = await startSearch(p1.agent);
    const s2 = await startSearch(p2.agent, { destination: { label: 'Kempegowda Airport Terminal 2', coordinates: { lat: 13.1989, lng: 77.7068 } } });
    return { owner, p1, p2, s1, s2 };
  }
  const publishedPool = async (agent: Agent) => (await CarOwnerPool.findById(await publishPool(agent)))!;

  it('saves the match for each passenger it suits and tells them straight away', async () => {
    const { owner, p1, p2, s1, s2 } = await setup();
    matcher.poolResult = fakeOwnerMatch('new-pool', 88);
    const pool = await publishedPool(owner.agent);
    notifier.sent = [];
    matcher.poolChecks = [];

    const notified = await onOwnerPoolPublished(pool, deps);

    expect(notified).toBe(2);
    expect(matcher.poolChecks.map((c) => c.poolId)).toEqual([pool.id, pool.id]);
    expect(notifier.sent.map((s) => s.userId).sort()).toEqual([p1.id, p2.id].sort());
    expect(notifier.sent.every((s) => s.event === 'search:update')).toBe(true);
    expect(notifier.sent.find((s) => s.userId === p1.id)!.payload).toEqual({ searchId: s1 });
    expect(notifier.sent.find((s) => s.userId === p2.id)!.payload).toEqual({ searchId: s2 });
    expect(((await CabPool.findById(s1))!.matches as unknown[]).length).toBe(1);
  });

  it('does not notify anyone when the new pool does not suit them', async () => {
    const { owner } = await setup();
    matcher.poolResult = null;
    const pool = await publishedPool(owner.agent);
    notifier.sent = [];

    expect(await onOwnerPoolPublished(pool, deps)).toBe(0);
    expect(notifier.sent).toEqual([]);
  });

  it('does not notify, and saves nothing, when the pool could not be verified (routing trouble)', async () => {
    const { owner, s1 } = await setup();
    matcher.poolResult = 'ROUTING_ERROR';
    const pool = await publishedPool(owner.agent);
    notifier.sent = [];

    expect(await onOwnerPoolPublished(pool, deps)).toBe(0);
    expect(notifier.sent).toEqual([]);
    expect((await CabPool.findById(s1))!.matches).toHaveLength(0);
  });

  it('skips searches that have ended, been cancelled, become open requests, or belong to the owner', async () => {
    const owner = await signUp('owner');
    const expired = await signUp('expired');
    const cancelled = await signUp('cancelled');
    const open = await signUp('open');
    const live = await signUp('live');

    const sExpired = await startSearch(expired.agent);
    await expireSearch(sExpired);
    const sCancelled = await startSearch(cancelled.agent);
    await cancelled.agent.post(`/api/pools/${sCancelled}/cancel-search`);
    const sOpen = await startSearch(open.agent);
    await expireSearch(sOpen);
    await open.agent.post(`/api/pools/${sOpen}/pooling-request`);
    await startSearch(owner.agent); // the owner's own search
    const sLive = await startSearch(live.agent);

    matcher.poolResult = fakeOwnerMatch('x', 80);
    const pool = await publishedPool(owner.agent);
    notifier.sent = [];
    matcher.poolChecks = [];

    expect(await onOwnerPoolPublished(pool, deps)).toBe(1);
    expect(matcher.poolChecks).toHaveLength(1);
    expect(matcher.poolChecks[0]!.request.userId).toBe(live.id);
    expect(notifier.sent.map((s) => s.payload)).toEqual([{ searchId: sLive }]);
  });

  it('does nothing for a pool that has no stored route yet', async () => {
    const { owner } = await setup();
    const pool = await publishedPool(owner.agent);
    await CarOwnerPool.updateOne({ _id: pool._id }, { $unset: { route: 1, routeLine: 1 } });
    matcher.poolChecks = [];

    expect(await onOwnerPoolPublished((await CarOwnerPool.findById(pool._id))!, deps)).toBe(0);
    expect(matcher.poolChecks).toHaveLength(0);
  });

  it('keeps going if one search fails to be checked', async () => {
    const { owner } = await setup();
    let calls = 0;
    const flaky = new FakeMatcher();
    flaky.evaluatePool = async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return fakeOwnerMatch('ok', 70);
    };
    const pool = await publishedPool(owner.agent);
    notifier.sent = [];

    expect(await onOwnerPoolPublished(pool, { matcher: flaky, notifier })).toBe(1);
  });
});

describe('the window itself', () => {
  it('is five minutes', () => {
    expect(MATCHING.SEARCH_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
