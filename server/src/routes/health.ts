import { Router } from 'express';
import { isDbConnected } from '../config/db.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', db: isDbConnected() ? 'connected' : 'disconnected', time: new Date().toISOString() },
  });
});
