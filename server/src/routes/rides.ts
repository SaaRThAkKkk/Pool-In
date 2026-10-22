import { Router, type RequestHandler } from 'express';
import { makeRideController } from '../controllers/rideController.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateObjectIdParam } from '../middleware/validate.js';
import { createRideSchema } from '../validators/rides.js';

export interface RidesRouterOptions {
  requireAuth: RequestHandler;
  requireVerifiedPhone: RequestHandler;
  rateLimitEnabled: boolean;
}

export function createRidesRouter({ requireAuth, requireVerifiedPhone, rateLimitEnabled }: RidesRouterOptions): Router {
  const router = Router();
  const controller = makeRideController();

  router.use(requireAuth);

  // Listing a ride puts a driver in front of strangers, so it is covered by the verified-phone policy
  // (currently switched off by REQUIRE_VERIFIED_PHONE_FOR_BOOKING=false).
  router.post(
    '/',
    requireVerifiedPhone,
    makeLimiter(rateLimitEnabled, { windowMs: 60 * 60 * 1000, limit: 30 }),
    validateBody(createRideSchema),
    controller.create,
  );
  router.get('/mine', controller.mine);
  router.get('/:id', validateObjectIdParam('id'), controller.getOne);

  return router;
}
