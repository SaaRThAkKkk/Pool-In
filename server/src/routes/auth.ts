import { Router } from 'express';
import { makeAuthController } from '../controllers/authController.js';
import { validateBody } from '../middleware/validate.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import { makeRequireAuth } from '../middleware/requireAuth.js';
import { loginSchema, registerSchema } from '../validators/auth.js';
import { signupOtpSendSchema, signupOtpVerifySchema, verifyOtpSchema } from '../validators/phone.js';
import type { TokenConfig } from '../utils/token.js';
import type { SmsProvider } from '../services/sms/index.js';

export interface AuthRouterOptions {
  token: TokenConfig;
  rateLimitEnabled: boolean;
  sms: SmsProvider;
}

const HOUR = 60 * 60 * 1000;

export function createAuthRouter({ token, rateLimitEnabled, sms }: AuthRouterOptions): Router {
  const router = Router();
  const controller = makeAuthController(token, { sms, secret: token.JWT_SECRET });
  const requireAuth = makeRequireAuth(token.JWT_SECRET);

  router.post(
    '/register',
    makeLimiter(rateLimitEnabled, { windowMs: HOUR, limit: 10 }),
    validateBody(registerSchema),
    controller.register,
  );

  // Per-account lockout lives in the service; this per-IP limiter is the outer layer.
  router.post(
    '/login',
    makeLimiter(rateLimitEnabled, { windowMs: 15 * 60 * 1000, limit: 30 }),
    validateBody(loginSchema),
    controller.login,
  );
  router.post('/logout', controller.logout);

  router.get('/me', requireAuth, controller.me);

  // Verify a phone number during registration, before an account exists. These send SMS to arbitrary
  // numbers, so per-phone limits (in the service) and per-IP limits apply. Add CAPTCHA before going public.
  router.post(
    '/phone/signup-otp/send',
    makeLimiter(rateLimitEnabled, { windowMs: HOUR, limit: 10 }),
    validateBody(signupOtpSendSchema),
    controller.sendSignupOtp,
  );
  router.post(
    '/phone/signup-otp/verify',
    makeLimiter(rateLimitEnabled, { windowMs: HOUR, limit: 60 }),
    validateBody(signupOtpVerifySchema),
    controller.verifySignupOtp,
  );

  // Per-user cooldown, hourly send cap and attempt limits are enforced in the service;
  // these per-IP limiters are an additional outer layer.
  router.post(
    '/phone/send-otp',
    requireAuth,
    makeLimiter(rateLimitEnabled, { windowMs: HOUR, limit: 20 }),
    controller.sendOtp,
  );
  router.post(
    '/phone/verify-otp',
    requireAuth,
    makeLimiter(rateLimitEnabled, { windowMs: HOUR, limit: 60 }),
    validateBody(verifyOtpSchema),
    controller.verifyOtp,
  );

  return router;
}
