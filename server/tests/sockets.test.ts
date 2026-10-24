import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { createSocketServer } from '../src/sockets/index.js';
import { User } from '../src/models/User.js';
import { clearDb, makeApp, startTestDb, stopTestDb, testConfig } from './helpers.js';

let server: http.Server;
let notifier: ReturnType<typeof createSocketServer>['notifier'];
let closeIo: () => void;
let url: string;
const open: Socket[] = [];

async function register(label: string, phone: string) {
  const res = await request(makeApp())
    .post('/api/auth/register')
    .send({ name: 'Rider One', email: `${label}@example.com`, phone, password: 'Passw0rdOK' });
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  return { id: res.body.data.user.id as string, cookie };
}

function client(cookie?: string): Socket {
  const socket = connect(url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: cookie ? { cookie } : {},
  });
  open.push(socket);
  return socket;
}

const connected = (s: Socket) => new Promise<void>((resolve, reject) => {
  s.on('connect', () => resolve());
  s.on('connect_error', (e) => reject(e));
});
const rejected = (s: Socket) => new Promise<string>((resolve) => s.on('connect_error', (e) => resolve(e.message)));
const next = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));
const quiet = (s: Socket, event: string, ms = 250) =>
  new Promise<boolean>((resolve) => {
    let heard = false;
    s.on(event, () => (heard = true));
    setTimeout(() => resolve(!heard), ms);
  });

beforeAll(async () => {
  await startTestDb();
  server = http.createServer(makeApp());
  const created = createSocketServer(server, testConfig);
  notifier = created.notifier;
  closeIo = () => void created.io.close();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  closeIo();
  await stopTestDb();
});
beforeEach(clearDb);
afterEach(() => {
  while (open.length) open.pop()!.disconnect();
});

describe('socket authentication', () => {
  it('rejects a connection with no session cookie', async () => {
    expect(await rejected(client())).toBe('UNAUTHORIZED');
  });

  it('rejects a forged or garbage token', async () => {
    expect(await rejected(client('pool_in_token=not-a-token'))).toBe('UNAUTHORIZED');
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011' }, 'some-other-secret-some-other-secret');
    expect(await rejected(client(`pool_in_token=${forged}`))).toBe('UNAUTHORIZED');
  });

  it('rejects a valid token for a user that does not exist', async () => {
    const token = jwt.sign({ sub: '507f1f77bcf86cd799439011' }, testConfig.JWT_SECRET);
    expect(await rejected(client(`pool_in_token=${token}`))).toBe('UNAUTHORIZED');
  });

  it('rejects a suspended account', async () => {
    const { cookie } = await register('suspended', '9876500001');
    await User.updateOne({ email: 'suspended@example.com' }, { accountStatus: 'SUSPENDED' });
    expect(await rejected(client(cookie))).toBe('UNAUTHORIZED');
  });

  it('accepts a signed-in user', async () => {
    const { cookie } = await register('ok', '9876500002');
    await connected(client(cookie));
  });

  it('ignores a different cookie and a token in the wrong place', async () => {
    const { cookie } = await register('other', '9876500003');
    const token = cookie.split('=')[1]!;
    expect(await rejected(client(`something_else=${token}`))).toBe('UNAUTHORIZED');
  });
});

describe('real-time search updates', () => {
  it('reach the signed-in user the update is for', async () => {
    const { id, cookie } = await register('me', '9876500004');
    const socket = client(cookie);
    await connected(socket);

    const heard = next<{ searchId: string }>(socket, 'search:update');
    notifier.notifyUser(id, 'search:update', { searchId: 'abc' });
    expect(await heard).toEqual({ searchId: 'abc' });
  });

  it('never reach anyone else', async () => {
    const me = await register('me2', '9876500005');
    const other = await register('other2', '9876500006');
    const mine = client(me.cookie);
    const theirs = client(other.cookie);
    await Promise.all([connected(mine), connected(theirs)]);

    const silent = quiet(theirs, 'search:update');
    const heard = next(mine, 'search:update');
    notifier.notifyUser(me.id, 'search:update', { searchId: 'private' });
    await heard;
    expect(await silent).toBe(true);
  });

  it('reach every tab the user has open', async () => {
    const { id, cookie } = await register('tabs', '9876500007');
    const one = client(cookie);
    const two = client(cookie);
    await Promise.all([connected(one), connected(two)]);

    const both = Promise.all([next(one, 'search:update'), next(two, 'search:update')]);
    notifier.notifyUser(id, 'search:update', { searchId: 'x' });
    await both;
  });

  it('cannot be listened to by joining someone else\'s room: clients have no way to join rooms', async () => {
    const victim = await register('victim', '9876500008');
    const attacker = await register('attacker', '9876500009');
    const spy = client(attacker.cookie);
    await connected(spy);

    // Try the obvious attempts; the server has no handlers for them.
    spy.emit('join', `user:${victim.id}`);
    spy.emit('join_room', `user:${victim.id}`);
    spy.emit('subscribe', victim.id);
    const silent = quiet(spy, 'search:update', 400);
    notifier.notifyUser(victim.id, 'search:update', { searchId: 'secret' });
    expect(await silent).toBe(true);
  });

  it('are simply dropped when the user is offline (the client also polls)', async () => {
    const { id } = await register('offline', '9876500010');
    expect(() => notifier.notifyUser(id, 'search:update', { searchId: 'x' })).not.toThrow();
  });
});
