import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { User, type UserDocument } from '../models/User.js';
import { AUTH_COOKIE } from '../utils/token.js';
import { AppError, unauthorized } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDocument;
  }
}

// Authenticates from the HttpOnly cookie and re-loads the user on every request,
// so suspensions take effect immediately.
export function makeRequireAuth(jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string') throw unauthorized();

    let sub: string;
    try {
      const payload = jwt.verify(token, jwtSecret);
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
      sub = payload.sub;
    } catch {
      throw unauthorized('Session expired or invalid. Please log in again.');
    }

    const user = await User.findById(sub);
    if (!user) throw unauthorized();
    if (user.accountStatus !== 'ACTIVE') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');
    }
    req.user = user;
    next();
  };
}
