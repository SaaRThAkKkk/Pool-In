import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { makeAuthController } from '../controllers/authController.js';
import { validateBody } from '../middleware/validate.js';
import { registerSchema } from '../validators/auth.js';
import type { TokenConfig } from '../utils/token.js';

export interface AuthRouterOptions {
  token: TokenConfig;
  rateLimitEnabled: boolean;
}

export function createAuthRouter({ token, rateLimitEnabled }: AuthRouterOptions): Router {
  const router = Router();
  const controller = makeAuthController(token);

  const limiter = rateLimitEnabled
    ? rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
          });
        },
      })
    : (_req: unknown, _res: unknown, next: () => void) => next();

  router.post('/register', limiter, validateBody(registerSchema), controller.register);
  return router;
}
