import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { makeRequireVerifiedPhone } from '../src/middleware/requireVerifiedPhone.js';
import { loadEnv } from '../src/config/env.js';
import type { UserDocument } from '../src/models/User.js';

function appFor(enabled: boolean, phoneVerifiedAt?: Date) {
  const app = express();
  // Stand-in for requireAuth: attach a fake user.
  app.use((req, _res, next) => {
    req.user = { phoneVerifiedAt } as UserDocument;
    next();
  });
  app.post('/book', makeRequireVerifiedPhone(enabled), (_req, res) => {
    res.json({ success: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireVerifiedPhone guard', () => {
  it('lets unverified users through while the policy is off', async () => {
    expect((await request(appFor(false)).post('/book')).status).toBe(200);
  });

  it('blocks unverified users when the policy is on', async () => {
    const res = await request(appFor(true)).post('/book');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('lets verified users through when the policy is on', async () => {
    expect((await request(appFor(true, new Date())).post('/book')).status).toBe(200);
  });
});

describe('REQUIRE_VERIFIED_PHONE_FOR_BOOKING setting', () => {
  const base = { MONGODB_URI: 'mongodb://x/y', JWT_SECRET: 'x'.repeat(32) };

  it('is off by default', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).REQUIRE_VERIFIED_PHONE_FOR_BOOKING).toBe(false);
  });

  it('can be switched on', () => {
    const env = loadEnv({ ...base, REQUIRE_VERIFIED_PHONE_FOR_BOOKING: 'true' } as NodeJS.ProcessEnv);
    expect(env.REQUIRE_VERIFIED_PHONE_FOR_BOOKING).toBe(true);
  });
});
