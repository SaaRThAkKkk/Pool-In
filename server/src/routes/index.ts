import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter, type AuthRouterOptions } from './auth.js';
import { createPoolsRouter } from './pools.js';
import type { PoolMatcher } from '../services/pools/matching.js';
import { createMapsRouter } from './maps.js';
import type { MapsProvider } from '../services/maps/types.js';
import { makeRequireAuth } from '../middleware/requireAuth.js';
import { makeRequireVerifiedPhone } from '../middleware/requireVerifiedPhone.js';

export interface ApiRouterOptions extends AuthRouterOptions {
  requireVerifiedPhoneForBooking: boolean;
  maps: MapsProvider;
  matcher: PoolMatcher;
}

export function createApiRouter(opts: ApiRouterOptions): Router {
  const apiRouter = Router();
  const requireAuth = makeRequireAuth(opts.token.JWT_SECRET);
  const requireVerifiedPhone = makeRequireVerifiedPhone(opts.requireVerifiedPhoneForBooking);

  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', createAuthRouter(opts));
  apiRouter.use(
    '/pools',
    createPoolsRouter({
      requireAuth,
      requireVerifiedPhone,
      matcher: opts.matcher,
      rateLimitEnabled: opts.rateLimitEnabled,
    }),
  );
  apiRouter.use('/maps', createMapsRouter({ requireAuth, maps: opts.maps, rateLimitEnabled: opts.rateLimitEnabled }));
  // Further routers (matching, join requests, offers, pool rooms, ...) are mounted here as each phase lands.
  return apiRouter;
}
