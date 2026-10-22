import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter, type AuthRouterOptions } from './auth.js';
import { createRidesRouter } from './rides.js';
import { makeRequireAuth } from '../middleware/requireAuth.js';
import { makeRequireVerifiedPhone } from '../middleware/requireVerifiedPhone.js';

export interface ApiRouterOptions extends AuthRouterOptions {
  requireVerifiedPhoneForBooking: boolean;
}

export function createApiRouter(opts: ApiRouterOptions): Router {
  const apiRouter = Router();
  const requireAuth = makeRequireAuth(opts.token.JWT_SECRET);
  const requireVerifiedPhone = makeRequireVerifiedPhone(opts.requireVerifiedPhoneForBooking);

  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', createAuthRouter(opts));
  apiRouter.use(
    '/rides',
    createRidesRouter({ requireAuth, requireVerifiedPhone, rateLimitEnabled: opts.rateLimitEnabled }),
  );
  // Further routers (matching, join requests, offers, pool rooms, ...) are mounted here as each phase lands.
  return apiRouter;
}
