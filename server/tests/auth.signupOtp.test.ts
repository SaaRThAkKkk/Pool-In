import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OTP } from '../src/config/otp.js';
import { OtpCode } from '../src/models/OtpCode.js';
import { User } from '../src/models/User.js';
import { CapturingSms, clearDb, makeApp, startTestDb, stopTestDb, testConfig } from './helpers.js';

const sms = new CapturingSms();
const app = makeApp({ sms });

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearDb();
  sms.sent = [];
  sms.failNext = false;
});

const PHONE = '9876543210';
const E164 = '+919876543210';

const sendCode = (phone = PHONE) => request(app).post('/api/auth/phone/signup-otp/send').send({ phone });
const verifyCode = (code: string, phone = PHONE) =>
  request(app).post('/api/auth/phone/signup-otp/verify').send({ phone, code });
const wrongCode = () => (sms.lastCode === '000000' ? '111111' : '000000');

const registerBody = (extra: object = {}) => ({
  name: 'Asha Verma',
  email: 'asha@example.com',
  phone: PHONE,
  password: 'Passw0rdOK',
  ...extra,
});

async function getProof(phone = PHONE) {
  expect((await sendCode(phone)).status).toBe(200);
  const res = await verifyCode(sms.lastCode!, phone);
  expect(res.status).toBe(200);
  return res.body.data.phoneProof as string;
}

describe('signup OTP: send', () => {
  it('needs no login, sends to the normalised phone, and never returns the code', async () => {
    const res = await sendCode('+91 98765-43210');
    expect(res.status).toBe(200);
    expect(sms.sent).toEqual([{ phone: E164, code: expect.stringMatching(/^\d{6}$/) }]);
    expect(res.body.data.maskedPhone).toBe('+91 ******3210');
    expect(JSON.stringify(res.body)).not.toContain(sms.lastCode!);
    expect(await OtpCode.countDocuments({ purpose: 'SIGNUP_PHONE', phone: E164 })).toBe(1);
  });

  it('rejects an invalid phone number', async () => {
    const res = await sendCode('12345');
    expect(res.status).toBe(400);
    expect(sms.sent).toHaveLength(0);
  });

  it('refuses to text a number that already has an account', async () => {
    await request(app).post('/api/auth/register').send(registerBody());
    const res = await sendCode();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    expect(sms.sent).toHaveLength(0);
  });

  it('applies the per-phone resend cooldown', async () => {
    await sendCode();
    const res = await sendCode();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(sms.sent).toHaveLength(1);
  });

  it('reports SMS failure honestly and does not burn the cooldown', async () => {
    sms.failNext = true;
    const res = await sendCode();
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SMS_DELIVERY_FAILED');
    expect((await sendCode()).status).toBe(200);
  });
});

describe('signup OTP: verify', () => {
  it('returns a phone proof for the correct code', async () => {
    await sendCode();
    const res = await verifyCode(sms.lastCode!);
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(E164);
    expect(typeof res.body.data.phoneProof).toBe('string');
  });

  it('rejects a wrong code with remaining attempts, and locks after too many', async () => {
    await sendCode();
    const first = await verifyCode(wrongCode());
    expect(first.status).toBe(422);
    expect(first.body.error.details.attemptsRemaining).toBe(OTP.MAX_ATTEMPTS - 1);

    for (let i = 1; i < OTP.MAX_ATTEMPTS; i++) await verifyCode(wrongCode());
    const locked = await verifyCode(sms.lastCode!);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('a code for one phone cannot verify another phone', async () => {
    await sendCode('9876543210');
    const res = await verifyCode(sms.lastCode!, '9123456780');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED_OR_MISSING');
  });

  it('rejects an expired code', async () => {
    await sendCode();
    await OtpCode.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await verifyCode(sms.lastCode!)).status).toBe(422);
  });
});

describe('registration with a phone proof', () => {
  it('creates a user whose phone is verified', async () => {
    const phoneProof = await getProof();
    const res = await request(app).post('/api/auth/register').send(registerBody({ phoneProof }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.phoneVerified).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(phoneProof);
    expect((await User.findOne())!.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it('creates an unverified user when no proof is sent ("verify later")', async () => {
    const res = await request(app).post('/api/auth/register').send(registerBody());
    expect(res.status).toBe(201);
    expect(res.body.data.user.phoneVerified).toBe(false);
  });

  it('rejects a proof issued for a different phone, and creates no user', async () => {
    const phoneProof = await getProof('9123456780');
    const res = await request(app).post('/api/auth/register').send(registerBody({ phoneProof }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_PROOF');
    expect(await User.countDocuments()).toBe(0);
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['a login token used as a proof', jwt.sign({ sub: 'x' }, testConfig.JWT_SECRET)],
    [
      'a forged proof signed with the session secret',
      jwt.sign({ typ: 'phone-proof', phone: E164 }, testConfig.JWT_SECRET),
    ],
  ])('rejects %s', async (_label, phoneProof) => {
    const res = await request(app).post('/api/auth/register').send(registerBody({ phoneProof }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_PROOF');
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects an expired proof', async () => {
    const expired = jwt.sign(
      { typ: 'phone-proof', phone: E164, exp: Math.floor(Date.now() / 1000) - 10 },
      `phone-proof:${testConfig.JWT_SECRET}`,
    );
    const res = await request(app).post('/api/auth/register').send(registerBody({ phoneProof: expired }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PHONE_PROOF');
  });

  it('a proof cannot be used as a login session', async () => {
    const phoneProof = await getProof();
    const res = await request(app).get('/api/auth/me').set('Cookie', `pool_in_token=${phoneProof}`);
    expect(res.status).toBe(401);
  });

  it('a signup code cannot verify a signed-in user\'s phone', async () => {
    await sendCode();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(registerBody());
    const res = await agent.post('/api/auth/phone/verify-otp').send({ code: sms.lastCode });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_EXPIRED_OR_MISSING');
    expect((await User.findOne())!.phoneVerifiedAt).toBeUndefined();
  });
});
