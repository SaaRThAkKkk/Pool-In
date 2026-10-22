import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppError } from '../src/utils/errors.js';
import { clearDb, FakeMaps, makeApp, startTestDb, stopTestDb } from './helpers.js';

const maps = new FakeMaps();
const app = makeApp({ maps });

async function signedIn(application = app) {
  const agent = request.agent(application);
  await agent
    .post('/api/auth/register')
    .send({ name: 'Asha Verma', email: 'asha@example.com', phone: '9876543210', password: 'Passw0rdOK' });
  return agent;
}

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  maps.searches = [];
  maps.routeCalls = [];
  maps.error = undefined;
});

describe('GET /api/maps/places', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/maps/places').query({ q: 'indira' });
    expect(res.status).toBe(401);
    expect(maps.searches).toHaveLength(0);
  });

  it('returns matching places', async () => {
    const agent = await signedIn();
    const res = await agent.get('/api/maps/places').query({ q: 'indira' });

    expect(res.status).toBe(200);
    expect(res.body.data.places[0]).toMatchObject({
      title: 'Indiranagar',
      label: 'Indiranagar, Bengaluru, Karnataka',
      lat: 12.9784,
      lng: 77.6408,
    });
    expect(maps.searches).toEqual([{ query: 'indira', bias: undefined }]);
  });

  it('passes the user position through as a ranking bias', async () => {
    const agent = await signedIn();
    await agent.get('/api/maps/places').query({ q: 'indira', lat: '12.97', lng: '77.59' });
    expect(maps.searches[0]).toEqual({ query: 'indira', bias: { lat: 12.97, lng: 77.59 } });
  });

  it('trims the search text', async () => {
    const agent = await signedIn();
    await agent.get('/api/maps/places').query({ q: '  indira  ' });
    expect(maps.searches[0]!.query).toBe('indira');
  });

  it.each([
    ['missing text', {}],
    ['one character', { q: 'a' }],
    ['text that is only spaces', { q: '   ' }],
    ['very long text', { q: 'x'.repeat(101) }],
    ['only one of lat/lng', { q: 'indira', lat: '12.9' }],
    ['latitude out of range', { q: 'indira', lat: '95', lng: '77' }],
    ['a non-numeric longitude', { q: 'indira', lat: '12', lng: 'east' }],
  ])('rejects %s with 400 and never calls the provider', async (_label, query) => {
    const agent = await signedIn();
    const res = await agent.get('/api/maps/places').query(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(maps.searches).toHaveLength(0);
  });

  it('rejects a repeated query parameter instead of guessing', async () => {
    const agent = await signedIn();
    const res = await agent.get('/api/maps/places?q=indira&q=whitefield');
    expect(res.status).toBe(400);
  });

  it('reports an upstream failure as 502 without leaking details', async () => {
    maps.error = new AppError(502, 'MAPS_UNAVAILABLE', 'Place search is temporarily unavailable. Please try again shortly.');
    const agent = await signedIn();
    const res = await agent.get('/api/maps/places').query({ q: 'indira' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('MAPS_UNAVAILABLE');
  });

  it('is rate limited', async () => {
    const limited = makeApp({ maps, rateLimitEnabled: true });
    const agent = await signedIn(limited);
    let last = 0;
    for (let i = 0; i < 151; i++) last = (await agent.get('/api/maps/places').query({ q: 'indira' })).status;
    expect(last).toBe(429);
  });
});

describe('GET /api/maps/route', () => {
  const q = { fromLat: '12.9784', fromLng: '77.6408', toLat: '13.1986', toLng: '77.7064' };

  it('requires authentication', async () => {
    expect((await request(app).get('/api/maps/route').query(q)).status).toBe(401);
  });

  it('returns the route with distance, duration and a drawable path', async () => {
    const agent = await signedIn();
    const res = await agent.get('/api/maps/route').query(q);

    expect(res.status).toBe(200);
    expect(res.body.data.route).toMatchObject({ distanceMeters: 35_214.6, durationSeconds: 2140.4 });
    expect(res.body.data.route.path).toHaveLength(2);
    expect(maps.routeCalls[0]).toEqual({
      from: { lat: 12.9784, lng: 77.6408 },
      to: { lat: 13.1986, lng: 77.7064 },
    });
  });

  it.each([
    ['a missing coordinate', { ...q, toLng: undefined }],
    ['a latitude out of range', { ...q, fromLat: '91' }],
    ['a non-numeric value', { ...q, toLat: 'north' }],
  ])('rejects %s with 400', async (_label, query) => {
    const agent = await signedIn();
    const res = await agent.get('/api/maps/route').query(query);
    expect(res.status).toBe(400);
    expect(maps.routeCalls).toHaveLength(0);
  });

  it('passes a "no route" answer through as 422', async () => {
    maps.error = new AppError(422, 'NO_ROUTE', 'No driving route was found between these two places.');
    const agent = await signedIn();
    const res = await agent.get('/api/maps/route').query(q);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_ROUTE');
  });
});
