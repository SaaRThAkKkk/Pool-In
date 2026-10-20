import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

export function makeLimiter(enabled: boolean, opts: { windowMs: number; limit: number }): RequestHandler {
  if (!enabled) return (_req, _res, next) => next();
  return rateLimit({
    ...opts,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      });
    },
  });
}
