import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { OTP } from '../src/config/otp.js';
import { OtpCode } from '../src/models/OtpCode.js';
import { User } from '../src/models/User.js';
import { CapturingSms, clearDb, makeApp, startTestDb, stopTestDb } from './helpers.js';

const sms = new CapturingSms();
const app = makeApp({ sms });

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  sms.sent = [];
  sms.failNext = false;
});

async function signUp(email = 'asha@example.com', phone = '9876543210') {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: 'Asha Verma', email, phone, password: 'Passw0rdOK' });
  expect(res.status).toBe(201);
  return agent;
}

const send = (a: ReturnType<typeof request.agent>) => a.post('/api/auth/phone/send-otp');
const verify = (a: ReturnType<typeof request.agent>, code: string) =>
  a.post('/api/auth/phone/verify-otp').send({ code });
const wrongCode = () => (sms.lastCode === '000000' ? '111111' : '000000');

// Moves existing OTP sends into the past so the resend cooldown no longer applies.
const ageOtps = (ms: number) =>
  OtpCode.updateMany({}, [{ $set: { createdAt: { $subtract: ['$createdAt', ms] } } }], { updatePipeline: true });

describe('GET /api/auth/me', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the current user with phoneVerified=false after registration', async () => {
    const agent = await signUp();
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ email: 'asha@example.com', phoneVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('rejects a tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'pool_in_token=not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('blocks suspended accounts', async () => {
    const agent = await signUp();
    await User.updateOne({}, { accountStatus: 'SUSPENDED' });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('POST /api/auth/phone/send-otp', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/auth/phone/send-otp')).status).toBe(401);
    expect((await request(app).post('/api/auth/phone/verify-otp').send({ code: '123456' })).status).toBe(401);
  });

  it('sends a 6-digit code to the normalised phone and never returns or stores it in plaintext', async () => {
    const agent = await signUp();
    const res = await send(agent);

    expect(res.status).toBe(200);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.phone).toBe('+919876543210');
    const code = sms.lastCode!;
    expect(code).toMatch(/^\d{6}$/);

    expect(res.body.data.maskedPhone).toBe('+91 ******3210');
    expect(JSON.stringify(res.body)).not.toContain(code);

    const stored = await OtpCode.findOne().lean();
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('enforces a resend cooldown with retryAfterSeconds', async () => {
    const agent = await signUp();
    await send(agent);
    const res = await send(agent);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(sms.sent).toHaveLength(1);
  });

  it('a new code invalidates the previous one', async () => {
    const agent = await signUp();
    await send(agent);
    const first = sms.lastCode!;
    await ageOtps(OTP.RESEND_COOLDOWN_MS + 1000);
    await send(agent);
    const second = sms.lastCode!;

    if (first !== second) {
      const old = await verify(agent, first);
      expect(old.status).toBe(422);
    }
    expect((await verify(agent, second)).status).toBe(200);
  });

  it('caps the number of codes per hour', async () => {
    const agent = await signUp();
    for (let i = 0; i < OTP.MAX_SENDS_PER_HOUR; i++) {
      expect((await send(agent)).status).toBe(200);
      await ageOtps(OTP.RESEND_COOLDOWN_MS + 1000);
    }
    const res = await send(agent);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_SEND_LIMIT');
  });

  it('reports SMS failure honestly and does not burn the cooldown', async () => {
    const agent = await signUp();
    sms.failNext = true;
    const res = await send(agent);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SMS_DELIVERY_FAILED');
    expect(await OtpCode.countDocuments()).toBe(0);

    expect((await send(agent)).status).toBe(200);
  });

  it('refuses if the phone is already verified', async () => {
    const agent = await signUp();
    await send(agent);
    await verify(agent, sms.lastCode!);
    const res = await send(agent);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_ALREADY_VERIFIED');
  });
});

describe('POST /api/auth/phone/verify-otp', () => {
  it('verifies the phone with the correct code', async () => {
    const agent = await signUp();
    await send(agent);
    const res = await verify(agent, sms.lastCode!);

    expect(res.status).toBe(200);
    expect(res.body.data.user.phoneVerified).toBe(true);
    expect((await agent.get('/api/auth/me')).body.data.user.phoneVerified).toBe(true);
    expect((await User.findOne())!.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code and reports remaining attempts', async () => {
    const agent = await signUp();
    await send(agent);
    const res = await verify(agent, wrongCode());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_INVALID');
    expect(res.body.error.details.attemptsRemaining).toBe(OTP.MAX_ATTEMPTS - 1);
    expect((await User.findOne())!.phoneVerifiedAt).toBeUndefined();
  });

  it('locks the code after too many wrong attempts, even for the correct code', async () => {
    const agent = await signUp();
    await send(agent);
    const correct = sms.lastCode!;
    for (let i = 0; i < OTP.MAX_ATTEMPTS; i++) {
      expect((await verify(agent, wrongCode())).status).toBe(422);
    }
    const res = await verify(agent, correct);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect((await User.findOne())!.phoneVerifiedAt).toBeUndefined();
  });

  it('parallel guesses cannot exceed the attempt limit', async () => {
    const agent = await signUp();
    await send(agent);
    const wrong = wrongCode();
    const results = await Promise.all(Array.from({ length: 12 }, () => verify(agent, wrong)));

    expect(results.filter((r) => r.status === 422)).toHaveLength(OTP.MAX_ATTEMPTS);
    expect(results.filter((r) => r.status === 429)).toHaveLength(12 - OTP.MAX_ATTEMPTS);
    expect((await OtpCode.findOne())!.attempts).toBe(OTP.MAX_ATTEMPTS);
  });

  it('rejects an expired code', async () => {
    const agent = await signUp();
    await send(agent);
    await OtpCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    const res = await verify(agent, sms.lastCode!);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED_OR_MISSING');
  });

  it('rejects verification when no code was requested', async () => {
    const agent = await signUp();
    const res = await verify(agent, '123456');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED_OR_MISSING');
  });

  it('a correct code can be consumed only once under concurrent requests', async () => {
    const agent = await signUp();
    await send(agent);
    const code = sms.lastCode!;
    const results = await Promise.all([verify(agent, code), verify(agent, code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => [409, 422].includes(r.status))).toBe(true);
  });

  it("one user's code does not verify another user", async () => {
    const a = await signUp('a@example.com', '9876543210');
    const b = await signUp('b@example.com', '9123456780');
    await send(a);
    const aCode = sms.lastCode!;
    await send(b);

    if (aCode !== sms.lastCode) {
      const res = await verify(b, aCode);
      expect(res.status).toBe(422);
    }
    expect((await User.findOne({ email: 'a@example.com' }))!.phoneVerifiedAt).toBeUndefined();
    expect((await User.findOne({ email: 'b@example.com' }))!.phoneVerifiedAt).toBeUndefined();
  });

  it.each(['12345', '1234567', 'abcdef', ''])('rejects malformed code %j with 400', async (code) => {
    const agent = await signUp();
    const res = await verify(agent, code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
