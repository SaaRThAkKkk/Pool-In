import { Router } from 'express';
import { healthRouter } from './health.js';
import { createAuthRouter, type AuthRouterOptions } from './auth.js';

export function createApiRouter(opts: AuthRouterOptions): Router {
  const apiRouter = Router();
  apiRouter.use('/health', healthRouter);
  apiRouter.use('/auth', createAuthRouter(opts));
  // Feature routers (vehicles, rides, matching, ...) are mounted here as each phase lands.
  return apiRouter;
}
