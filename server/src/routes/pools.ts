import { Router, type RequestHandler } from 'express';
import { makePoolController, type PoolControllerDeps } from '../controllers/poolController.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateObjectIdParam } from '../middleware/validate.js';
import { poolInSchema } from '../validators/pools.js';

export interface PoolsRouterOptions extends PoolControllerDeps {
  requireAuth: RequestHandler;
  requireVerifiedPhone: RequestHandler;
  rateLimitEnabled: boolean;
}

export function createPoolsRouter({ requireAuth, requireVerifiedPhone, rateLimitEnabled, ...deps }: PoolsRouterOptions): Router {
  const router = Router();
  const controller = makePoolController(deps);
  const id = validateObjectIdParam('id');

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

  // The five-minute search. Polling is cheap: only pools published since the last check are looked at.
  router.get('/:id/search', id, makeLimiter(rateLimitEnabled, { windowMs: 60 * 1000, limit: 30 }), controller.search);
  router.post('/:id/cancel-search', id, controller.stopSearch);
  // After the search ends: ask to be matched with other passengers instead.
  router.post('/:id/pooling-request', id, requireVerifiedPhone, controller.poolingRequest);
  router.get('/:id/passenger-matches', id, makeLimiter(rateLimitEnabled, { windowMs: 60 * 1000, limit: 20 }), controller.passengerMatches);

  router.get('/:id', id, controller.getOne);

  return router;
}
