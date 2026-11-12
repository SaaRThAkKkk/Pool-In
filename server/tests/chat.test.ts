import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CHAT } from '../src/config/chat.js';
import { Conversation, Message, VoiceNote } from '../src/models/Chat.js';
import { looksLikeAudio } from '../src/services/chat/chatService.js';
import type { PassengerMatch } from '../src/services/matching/types.js';
import { clearDb, fakeOwnerMatch, FakeMatcher, makeApp, RecordingNotifier, startTestDb, stopTestDb } from './helpers.js';

const matcher = new FakeMatcher();
const notifier = new RecordingNotifier();
const app = makeApp({ matcher, notifier });
type Agent = ReturnType<typeof request.agent>;

let n = 0;
async function signUp(name = 'Asha Verma') {
  n += 1;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name, email: `chat${n}@example.com`, phone: `97${String(10000000 + n)}`, password: 'Passw0rdOK' });
  expect(res.status).toBe(201);
  return { agent, id: res.body.data.user.id as string };
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const trip = (over: Record<string, unknown> = {}) => ({
  origin: { label: 'Whitefield, Bengaluru', coordinates: { lat: 12.9698, lng: 77.75 } },
  destination: { label: 'Kempegowda Airport', coordinates: { lat: 13.1986, lng: 77.7066 } },
  arriveBy: hoursFromNow(48),
  luggage: { large: 0, medium: 0, cabin: 1, backpack: 0, oversized: 0 },
  ...over,
});
const poolCab = (over: Record<string, unknown> = {}) => ({ mode: 'POOL_CAB', ...trip(), people: 1, ...over });
const ownVehicle = (over: Record<string, unknown> = {}) => ({
  mode: 'OWN_VEHICLE',
  ...trip(),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: 3,
  askingPrice: 250,
  negotiable: false,
  ...over,
});

const publishPool = async (agent: Agent) => (await agent.post('/api/pools').send(ownVehicle())).body.data.pool.id as string;
const searchFor = async (agent: Agent, over: Record<string, unknown> = {}) => {
  const res = await agent.post('/api/pools').send(poolCab(over));
  expect(res.body.data.outcome).toBe('SEARCH_STARTED');
  return res.body.data.pool.id as string;
};

const fakeGroup = (requestId: string): PassengerMatch => ({
  section: 'CAB',
  requestId,
  score: 70,
  breakdown: [],
  reasons: [],
  otherPeople: 1,
  groupSize: 2,
  pickup: { lat: 12.98, lng: 77.64, roadKmForYou: 0.4 },
  dropoff: { lat: 13.19, lng: 77.7, roadKmForYou: 0.3 },
  rideKm: 24,
  rideMinutes: 41,
  note: 'A proposed group, not a confirmed ride.',
  evaluatedAt: new Date().toISOString(),
});

// What a browser recorder produces starts with these bytes (webm / matroska), then audio data.
const webm = (size = 2000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size, 7)]);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  await Promise.all([Conversation.deleteMany({}), Message.deleteMany({}), VoiceNote.deleteMany({})]);
  Object.assign(matcher, { ownerCalls: [], peerCalls: [], poolChecks: [], nearbyCalls: [], nearby: [], ownerMatches: [], groups: [], ownerStatus: 'OK', poolResult: null });
  notifier.sent = [];
});

// A driver with a pool, and a passenger who has searched, with the matcher saying they fit.
async function matchedPair() {
  const driver = await signUp('Ravi Kumar');
  const rider = await signUp('Asha Verma');
  const poolId = await publishPool(driver.agent);
  const requestId = await searchFor(rider.agent);
  matcher.poolResult = fakeOwnerMatch(poolId);
  const res = await rider.agent.post('/api/chat/conversations').send({ poolId, requestId });
  expect(res.status).toBe(200);
  return { driver, rider, poolId, requestId, conversationId: res.body.data.conversation.id as string };
}

describe('starting a chat (only when the trips really match)', () => {
  it('needs login', async () => {
    expect((await request(app).get('/api/chat/conversations')).status).toBe(401);
    expect((await request(app).post('/api/chat/conversations').send({})).status).toBe(401);
  });

  it('opens a chat between a passenger and the driver of a matching pool, showing only first names', async () => {
    const { rider, driver, conversationId } = await matchedPair();

    const mine = (await rider.agent.get('/api/chat/conversations')).body.data.conversations;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: conversationId, kind: 'OWNER_MATCH', with: { name: 'Ravi', role: 'DRIVER' }, unread: 0 });
    expect(mine[0].trip).toEqual({ from: 'Whitefield, Bengaluru', to: 'Kempegowda Airport' });

    // The driver sees it too, with the passenger's first name.
    const theirs = (await driver.agent.get('/api/chat/conversations')).body.data.conversations;
    expect(theirs[0]).toMatchObject({ id: conversationId, with: { name: 'Asha', role: 'PASSENGER' } });
  });

  it('is safe to repeat: the same two people about the same pool always get the same chat', async () => {
    const { rider, poolId, requestId, conversationId } = await matchedPair();
    const again = await rider.agent.post('/api/chat/conversations').send({ poolId, requestId });
    expect(again.body.data.conversation.id).toBe(conversationId);
    expect(await Conversation.countDocuments()).toBe(1);
  });

  it('works for a passenger whose search found a pool straight away (nothing was saved), using the trip itself', async () => {
    const driver = await signUp('Ravi Kumar');
    const rider = await signUp();
    const poolId = await publishPool(driver.agent);
    matcher.poolResult = fakeOwnerMatch(poolId);

    const res = await rider.agent.post('/api/chat/conversations').send({ poolId, trip: poolCab() });
    expect(res.status).toBe(200);
    expect(res.body.data.conversation.with.role).toBe('DRIVER');
  });

  it('refuses when the pool no longer fits, or the check cannot be made', async () => {
    const driver = await signUp('Ravi Kumar');
    const rider = await signUp();
    const poolId = await publishPool(driver.agent);
    const requestId = await searchFor(rider.agent);

    matcher.poolResult = null;
    const noMatch = await rider.agent.post('/api/chat/conversations').send({ poolId, requestId });
    expect(noMatch.status).toBe(409);
    expect(noMatch.body.error.code).toBe('NOT_A_MATCH');

    matcher.poolResult = 'ROUTING_ERROR';
    expect((await rider.agent.post('/api/chat/conversations').send({ poolId, requestId })).status).toBe(502);
    expect(await Conversation.countDocuments()).toBe(0);
  });

  it('refuses your own pool, a missing pool, someone else\'s request, and malformed bodies', async () => {
    const driver = await signUp('Ravi Kumar');
    const rider = await signUp();
    const poolId = await publishPool(driver.agent);
    const riderRequest = await searchFor(rider.agent);
    const driverRequest = await searchFor(driver.agent, { people: 2 });
    matcher.poolResult = fakeOwnerMatch(poolId);

    expect((await driver.agent.post('/api/chat/conversations').send({ poolId, requestId: driverRequest })).status).toBe(403);
    expect((await rider.agent.post('/api/chat/conversations').send({ poolId: '507f1f77bcf86cd799439011', requestId: riderRequest })).status).toBe(404);
    // using a request that belongs to somebody else
    expect((await driver.agent.post('/api/chat/conversations').send({ poolId, requestId: riderRequest })).status).toBe(404);
    expect((await rider.agent.post('/api/chat/conversations').send({ poolId: 'nope', requestId: riderRequest })).status).toBe(400);
    expect((await rider.agent.post('/api/chat/conversations').send({ poolId, requestId: riderRequest, extra: 1 })).status).toBe(400);
    expect((await rider.agent.post('/api/chat/conversations').send({})).status).toBe(400);
  });

  it('opens a chat between two passengers only when the other is one of the proposed groups', async () => {
    const a = await signUp('Asha Verma');
    const b = await signUp('Bala Singh');
    const aRequest = await searchFor(a.agent);
    const bRequest = await searchFor(b.agent);

    matcher.groups = [];
    const refused = await a.agent.post('/api/chat/conversations').send({ requestId: aRequest, otherRequestId: bRequest });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NOT_A_MATCH');

    matcher.groups = [fakeGroup(bRequest)];
    const ok = await a.agent.post('/api/chat/conversations').send({ requestId: aRequest, otherRequestId: bRequest });
    expect(ok.status).toBe(200);
    expect(ok.body.data.conversation).toMatchObject({ kind: 'PASSENGER_MATCH', with: { name: 'Bala', role: 'PASSENGER' } });

    // Either of them starting it ends up in the same chat.
    matcher.groups = [fakeGroup(aRequest)];
    const fromB = await b.agent.post('/api/chat/conversations').send({ requestId: bRequest, otherRequestId: aRequest });
    expect(fromB.body.data.conversation.id).toBe(ok.body.data.conversation.id);

    // and never with yourself
    expect((await a.agent.post('/api/chat/conversations').send({ requestId: aRequest, otherRequestId: aRequest })).status).toBe(403);
  });
});

describe('messages', () => {
  it('sends text both ways, in order, and shows who sent what', async () => {
    const { rider, driver, conversationId } = await matchedPair();
    await rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text: '  Hi, I am at the metro  ' });
    await driver.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text: 'Great, see you at 8' });

    const asRider = (await rider.agent.get(`/api/chat/conversations/${conversationId}/messages`)).body.data.messages;
    expect(asRider.map((m: { text: string; mine: boolean }) => [m.text, m.mine])).toEqual([
      ['Hi, I am at the metro', true],
      ['Great, see you at 8', false],
    ]);
    const asDriver = (await driver.agent.get(`/api/chat/conversations/${conversationId}/messages`)).body.data.messages;
    expect(asDriver.map((m: { mine: boolean }) => m.mine)).toEqual([false, true]);
  });

  it('returns only newer messages when asked "after" one, so polling stays small', async () => {
    const { rider, conversationId } = await matchedPair();
    const send = (text: string) => rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text });
    const first = (await send('one')).body.data.message.id;
    await send('two');

    const newer = (await rider.agent.get(`/api/chat/conversations/${conversationId}/messages`).query({ after: first })).body.data.messages;
    expect(newer.map((m: { text: string }) => m.text)).toEqual(['two']);
    expect((await rider.agent.get(`/api/chat/conversations/${conversationId}/messages`).query({ after: 'x' })).status).toBe(400);
  });

  it('rejects empty, blank and over-long text, and unknown message types', async () => {
    const { rider, conversationId } = await matchedPair();
    const url = `/api/chat/conversations/${conversationId}/messages`;
    expect((await rider.agent.post(url).send({ type: 'TEXT', text: '   ' })).status).toBe(400);
    expect((await rider.agent.post(url).send({ type: 'TEXT', text: 'x'.repeat(CHAT.MAX_TEXT_LENGTH + 1) })).status).toBe(400);
    expect((await rider.agent.post(url).send({ type: 'TEXT', text: 'x'.repeat(CHAT.MAX_TEXT_LENGTH) })).status).toBe(201);
    expect((await rider.agent.post(url).send({ type: 'VOICE', text: 'hi' })).status).toBe(400);
    expect((await rider.agent.post(url).send({ text: 'no type' })).status).toBe(400);
  });

  it('keeps markup as plain text (the page never renders it as HTML)', async () => {
    const { rider, conversationId } = await matchedPair();
    const res = await rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text: '<img src=x onerror=alert(1)>' });
    expect(res.body.data.message.text).toBe('<img src=x onerror=alert(1)>');
  });

  it('counts unread messages for the other person, and clears them when the chat is opened', async () => {
    const { rider, driver, conversationId } = await matchedPair();
    const send = (text: string) => rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text });
    await send('a');
    await send('b');

    const unread = async (who: typeof driver) => (await who.agent.get('/api/chat/conversations')).body.data.conversations[0].unread;
    expect(await unread(driver)).toBe(2);
    expect(await unread(rider)).toBe(0); // your own messages are never "unread"

    expect((await driver.agent.post(`/api/chat/conversations/${conversationId}/read`)).status).toBe(200);
    expect(await unread(driver)).toBe(0);
    await send('c');
    expect(await unread(driver)).toBe(1);
  });

  it('shows the latest message in the inbox, and tells the other person in real time', async () => {
    const { rider, driver, conversationId } = await matchedPair();
    notifier.sent = [];
    await rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'TEXT', text: 'On my way' });

    const row = (await driver.agent.get('/api/chat/conversations')).body.data.conversations[0];
    expect(row.lastMessage).toMatchObject({ type: 'TEXT', preview: 'On my way', mine: false });
    expect(notifier.sent).toEqual([{ userId: driver.id, event: 'chat:message', payload: { conversationId } }]);
  });
});

describe('sharing a location', () => {
  it('sends the coordinates as a location message', async () => {
    const { rider, driver, conversationId } = await matchedPair();
    const res = await rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'LOCATION', lat: 13.0, lng: 77.677 });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({ type: 'LOCATION', location: { lat: 13, lng: 77.677 }, mine: true });

    const seen = (await driver.agent.get(`/api/chat/conversations/${conversationId}/messages`)).body.data.messages[0];
    expect(seen).toMatchObject({ type: 'LOCATION', location: { lat: 13, lng: 77.677 }, mine: false });
  });

  it.each([
    ['latitude out of range', { lat: 91, lng: 77 }],
    ['longitude out of range', { lat: 13, lng: 181 }],
    ['not numbers', { lat: '13', lng: '77' }],
    ['missing', {}],
  ])('rejects %s', async (_label, coords) => {
    const { rider, conversationId } = await matchedPair();
    const res = await rider.agent.post(`/api/chat/conversations/${conversationId}/messages`).send({ type: 'LOCATION', ...coords });
    expect(res.status).toBe(400);
  });
});

describe('voice notes', () => {
  const upload = (agent: Agent, id: string, body: Buffer, type = 'audio/webm;codecs=opus', ms = 4000) =>
    agent.post(`/api/chat/conversations/${id}/voice`).set('Content-Type', type).set('X-Duration-Ms', String(ms)).send(body);

  it('sends a recording and lets the other person play it back', async () => {
    const { rider, driver, conversationId } = await matchedPair();
    const audio = webm();
    const res = await upload(rider.agent, conversationId, audio);
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatchObject({ type: 'VOICE', mine: true, voice: { durationMs: 4000, mime: 'audio/webm' } });

    const seen = (await driver.agent.get(`/api/chat/conversations/${conversationId}/messages`)).body.data.messages[0];
    expect(seen.voice.url).toMatch(/^\/api\/chat\/voice\//);

    const played = await driver.agent.get(seen.voice.url).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(played.status).toBe(200);
    expect(played.headers['content-type']).toBe('audio/webm');
    expect(Buffer.compare(played.body as Buffer, audio)).toBe(0);
  });

  it('keeps the audio out of the message list', async () => {
    const { rider, conversationId } = await matchedPair();
    await upload(rider.agent, conversationId, webm());
    const raw = (await rider.agent.get(`/api/chat/conversations/${conversationId}/messages`)).text;
    expect(raw.length).toBeLessThan(1000);
  });

  it('only the two people in the chat can hear it', async () => {
    const { rider, conversationId } = await matchedPair();
    const message = (await upload(rider.agent, conversationId, webm())).body.data.message;
    const stranger = await signUp('Stranger Danger');

    expect((await stranger.agent.get(message.voice.url)).status).toBe(404);
    expect((await request(app).get(message.voice.url)).status).toBe(401);
    expect((await rider.agent.get('/api/chat/voice/not-an-id')).status).toBe(404);
  });

  it('rejects an unsupported type, an empty body, a non-audio file, a bad length and a file that is too big', async () => {
    const { rider, conversationId } = await matchedPair();
    expect((await upload(rider.agent, conversationId, webm(), 'text/html')).status).toBe(400);
    expect((await upload(rider.agent, conversationId, Buffer.alloc(0))).status).toBe(400);
    expect((await upload(rider.agent, conversationId, Buffer.from('<html><script>alert(1)</script></html>'))).status).toBe(400);
    expect((await upload(rider.agent, conversationId, webm(), 'audio/webm', 0)).status).toBe(400);
    expect((await upload(rider.agent, conversationId, webm(), 'audio/webm', CHAT.MAX_VOICE_MS + 1)).status).toBe(400);
    expect((await upload(rider.agent, conversationId, webm(), 'audio/webm', Number.NaN)).status).toBe(400);
    expect((await upload(rider.agent, conversationId, webm(CHAT.MAX_VOICE_BYTES + 10))).status).toBeGreaterThanOrEqual(400);
    expect(await Message.countDocuments()).toBe(0);
    expect(await VoiceNote.countDocuments()).toBe(0);
  });

  it('recognises real audio headers and not other files', () => {
    expect(looksLikeAudio(webm())).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]))).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(20)]))).toBe(true);
    expect(looksLikeAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)]))).toBe(true);
    expect(looksLikeAudio(Buffer.from('<html>not audio at all</html>'))).toBe(false);
    expect(looksLikeAudio(Buffer.from([1, 2, 3]))).toBe(false);
  });
});

describe('privacy: only the two people in a chat can use it', () => {
  it('answers a stranger exactly like a chat that does not exist', async () => {
    const { conversationId } = await matchedPair();
    const stranger = await signUp('Stranger Danger');
    const url = `/api/chat/conversations/${conversationId}`;

    expect((await stranger.agent.get(url)).status).toBe(404);
    expect((await stranger.agent.get(`${url}/messages`)).status).toBe(404);
    expect((await stranger.agent.post(`${url}/messages`).send({ type: 'TEXT', text: 'hello' })).status).toBe(404);
    expect((await stranger.agent.post(`${url}/voice`).set('Content-Type', 'audio/webm').set('X-Duration-Ms', '2000').send(webm())).status).toBe(404);
    expect((await stranger.agent.post(`${url}/read`)).status).toBe(404);
    expect((await stranger.agent.get('/api/chat/conversations')).body.data.conversations).toEqual([]);
    expect((await stranger.agent.get('/api/chat/conversations/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await stranger.agent.get('/api/chat/conversations/not-an-id')).status).toBe(404);
    expect(await Message.countDocuments()).toBe(0);
  });
});
