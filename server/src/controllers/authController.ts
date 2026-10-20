import type { RequestHandler } from 'express';
import { toPublicUser } from '../models/User.js';
import { registerUser } from '../services/auth/authService.js';
import { AUTH_COOKIE, authCookieOptions, signToken, type TokenConfig } from '../utils/token.js';
import type { RegisterInput } from '../validators/auth.js';

export function makeAuthController(cfg: TokenConfig) {
  const register: RequestHandler = async (req, res) => {
    const user = await registerUser(req.body as RegisterInput);
    res.cookie(AUTH_COOKIE, signToken(user.id, cfg), authCookieOptions(cfg));
    res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
  };

  return { register };
}
