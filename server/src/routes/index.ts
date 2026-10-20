import { Router } from 'express';
import { healthRouter } from './health.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
// Feature routers (auth, vehicles, rides, matching, ...) are mounted here as each phase lands.
