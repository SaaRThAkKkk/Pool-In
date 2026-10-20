import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/User.js';
import { normalizeIndianPhone } from '../src/validators/auth.js';
import { clearDb, makeApp, startTestDb, stopTestDb, testConfig } from './helpers.js';

const app = makeApp();

const valid = {
  name: 'Asha Verma',
  email: 'Asha@Example.com',
  phone: '98765 43210',
  password: 'Passw0rdOK',
  gender: 'female',
};

const register = (body: object = valid) => request(app).post('/api/auth/register').send(body);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearDb);

describe('POST /api/auth/register', () => {
  it('creates a user, normalises email/phone, and signs them in with an HttpOnly cookie', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      name: 'Asha Verma',
      email: 'asha@example.com',
      phone: '+919876543210',
      gender: 'female',
      role: 'user',
      verificationStatus: 'UNVERIFIED',
    });

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^pool_in_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const token = cookie.split(';')[0]!.split('=')[1]!;
    const payload = jwt.verify(token, testConfig.JWT_SECRET) as { sub: string };
    expect(payload.sub).toBe(res.body.data.user.id);
  });

  it('never returns or stores the plaintext password', async () => {
    const res = await register();
    expect(JSON.stringify(res.body)).not.toMatch(/passw0rdok|passwordHash/i);

    const stored = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toContain('Passw0rdOK');
    expect(await bcrypt.compare('Passw0rdOK', stored!.passwordHash)).toBe(true);
  });

  it('ignores attempts to set privileged fields (no over-posting)', async () => {
    const res = await register({ ...valid, role: 'admin', accountStatus: 'SUSPENDED', verificationStatus: 'VERIFIED' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('user');
    expect(res.body.data.user.verificationStatus).toBe('UNVERIFIED');
    const stored = await User.findOne({ email: 'asha@example.com' });
    expect(stored?.accountStatus).toBe('ACTIVE');
  });

  it('defaults gender to prefer_not_to_say when omitted', async () => {
    const { gender: _g, ...rest } = valid;
    const res = await register(rest);
    expect(res.status).toBe(201);
    expect(res.body.data.user.gender).toBe('prefer_not_to_say');
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await register();
    const res = await register({ ...valid, email: 'ASHA@example.com', phone: '9123456780' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a duplicate phone written in a different format with 409', async () => {
    await register();
    const res = await register({ ...valid, email: 'other@example.com', phone: '+91-98765-43210' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('allows only one of two simultaneous registrations for the same email', async () => {
    const results = await Promise.all([
      register({ ...valid, phone: '9876543210' }),
      register({ ...valid, phone: '9123456780' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });

  it.each([
    ['missing name', { name: '' }],
    ['invalid email', { email: 'not-an-email' }],
    ['non-Indian phone', { phone: '12345' }],
    ['short password', { password: 'Ab1' }],
    ['password without a number', { password: 'onlyletters' }],
    ['password without a letter', { password: '12345678' }],
    ['password over 72 chars', { password: 'a1'.repeat(40) }],
    ['unknown gender value', { gender: 'robot' }],
  ])('rejects %s with 400 and the standard error envelope', async (_label, override) => {
    const res = await register({ ...valid, ...override });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await User.countDocuments()).toBe(0);
  });

  it('rate-limits repeated attempts with 429', async () => {
    const limited = makeApp({ rateLimitEnabled: true });
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await request(limited).post('/api/auth/register').send({})).status;
    }
    expect(last).toBe(429);
  });
});

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeIndianPhone(input)).toBe(expected);
  });

  it.each(['5876543210', '98765', '+1 415 555 0100', 'abcdefghij'])('rejects %s', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });
});
