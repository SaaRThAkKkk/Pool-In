import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter, type AuthRouterOptions } from './auth.js';
import { makeRequireVerifiedPhone } from '../middleware/requireVerifiedPhone.js';

export interface ApiRouterOptions extends AuthRouterOptions {
  requireVerifiedPhoneForBooking: boolean;
}

export function createApiRouter(opts: ApiRouterOptions): Router {
  const apiRouter = Router();
  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', createAuthRouter(opts));

  // Apply to every route that books or joins a ride (after requireAuth) once those routes exist:
  //   router.post('/rides/:id/join-requests', requireAuth, requireVerifiedPhone, ...)
  const _requireVerifiedPhone = makeRequireVerifiedPhone(opts.requireVerifiedPhoneForBooking);
  void _requireVerifiedPhone;

  // Feature routers (vehicles, rides, matching, ...) are mounted here as each phase lands.
  return apiRouter;
}
