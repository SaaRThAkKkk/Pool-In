import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { LOGIN_POLICY } from '../src/config/loginPolicy.js';
import { User } from '../src/models/User.js';
import { clearDb, makeApp, startTestDb, stopTestDb } from './helpers.js';

const app = makeApp();

const account = { name: 'Asha Verma', email: 'asha@example.com', phone: '9876543210', password: 'Passw0rdOK' };
const login = (body: object, a: { post: (u: string) => request.Test } = request(app)) =>
  a.post('/api/auth/login').send(body);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  await request(app).post('/api/auth/register').send(account);
});

describe('POST /api/auth/login', () => {
  it('signs in with the right credentials and sets an HttpOnly session cookie', async () => {
    const agent = request.agent(app);
    const res = await login({ email: account.email, password: account.password }, agent);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'asha@example.com', role: 'user' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Passw0rdOK/);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^pool_in_token=/);
    expect(cookie).toMatch(/HttpOnly/i);

    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('treats the email case-insensitively', async () => {
    const res = await login({ email: '  ASHA@Example.COM ', password: account.password });
    expect(res.status).toBe(200);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await login({ email: account.email, password: 'WrongPass1' });
    const unknown = await login({ email: 'nobody@example.com', password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['missing password', { email: 'a@b.co' }],
    ['missing email', { password: 'x' }],
    ['empty password', { email: 'a@b.co', password: '' }],
    ['oversized password', { email: 'a@b.co', password: 'x'.repeat(500) }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await login(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not accept a NoSQL-style object as the email', async () => {
    const res = await login({ email: { $ne: '' }, password: 'x' });
    expect(res.status).toBe(400);
  });

  it('locks the account after too many failures, even for the correct password', async () => {
    for (let i = 0; i < LOGIN_POLICY.MAX_FAILED_ATTEMPTS; i++) {
      expect((await login({ email: account.email, password: 'WrongPass1' })).status).toBe(401);
    }
    const locked = await login({ email: account.email, password: account.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts parallel wrong guesses so they cannot dodge the lock', async () => {
    await Promise.all(
      Array.from({ length: LOGIN_POLICY.MAX_FAILED_ATTEMPTS + 3 }, () =>
        login({ email: account.email, password: 'WrongPass1' }),
      ),
    );
    const res = await login({ email: account.email, password: account.password });
    expect(res.status).toBe(429);
  });

  it('unlocks after the lock expires and resets the counters', async () => {
    for (let i = 0; i < LOGIN_POLICY.MAX_FAILED_ATTEMPTS; i++) {
      await login({ email: account.email, password: 'WrongPass1' });
    }
    await User.updateOne({}, { lockedUntil: new Date(Date.now() - 1000) });

    const res = await login({ email: account.email, password: account.password });
    expect(res.status).toBe(200);
    const stored = await User.findOne();
    expect(stored!.failedLoginAttempts).toBe(0);
    expect(stored!.lockedUntil).toBeUndefined();
  });

  it('a successful login clears earlier failed attempts', async () => {
    await login({ email: account.email, password: 'WrongPass1' });
    await login({ email: account.email, password: 'WrongPass1' });
    expect((await login({ email: account.email, password: account.password })).status).toBe(200);
    expect((await User.findOne())!.failedLoginAttempts).toBe(0);
  });

  it('rejects a suspended account only after the password is proven', async () => {
    await User.updateOne({}, { accountStatus: 'SUSPENDED' });
    const good = await login({ email: account.email, password: account.password });
    expect(good.status).toBe(403);
    expect(good.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(good.headers['set-cookie']).toBeUndefined();

    const bad = await login({ email: account.email, password: 'WrongPass1' });
    expect(bad.status).toBe(401);
  });

  it('is rate limited per IP', async () => {
    const limited = makeApp({ rateLimitEnabled: true });
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await request(limited).post('/api/auth/login').send({ email: 'x@y.co', password: 'x' })).status;
    }
    expect(last).toBe(429);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie so the user is signed out', async () => {
    const agent = request.agent(app);
    await login({ email: account.email, password: account.password }, agent);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^pool_in_token=;/);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('succeeds even when not signed in', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(200);
  });
});
