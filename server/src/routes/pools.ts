import { Router, type RequestHandler } from 'express';
import { makePoolController } from '../controllers/poolController.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateObjectIdParam } from '../middleware/validate.js';
import type { PoolMatcher } from '../services/pools/matching.js';
import { poolInSchema } from '../validators/pools.js';

export interface PoolsRouterOptions {
  requireAuth: RequestHandler;
  requireVerifiedPhone: RequestHandler;
  matcher: PoolMatcher;
  rateLimitEnabled: boolean;
}

export function createPoolsRouter({ requireAuth, requireVerifiedPhone, matcher, rateLimitEnabled }: PoolsRouterOptions): Router {
  const router = Router();
  const controller = makePoolController(matcher);

  router.use(requireAuth);

  // Pooling puts a person in front of strangers, so it is covered by the verified-phone policy
  // (currently switched off by REQUIRE_VERIFIED_PHONE_FOR_BOOKING=false).
  router.post(
    '/',
    requireVerifiedPhone,
    makeLimiter(rateLimitEnabled, { windowMs: 60 * 60 * 1000, limit: 30 }),
    validateBody(poolInSchema),
    controller.poolIn,
  );
  router.get('/mine', controller.mine);
  router.get('/:id', validateObjectIdParam('id'), controller.getOne);

  return router;
}
