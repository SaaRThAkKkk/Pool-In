import jwt from 'jsonwebtoken';
import type { CookieOptions } from 'express';

export const AUTH_COOKIE = 'pool_in_token';

export interface TokenConfig {
  JWT_SECRET: string;
  JWT_EXPIRES_DAYS: number;
  NODE_ENV: string;
}

export function signToken(userId: string, cfg: TokenConfig): string {
  return jwt.sign({ sub: userId }, cfg.JWT_SECRET, { expiresIn: cfg.JWT_EXPIRES_DAYS * 24 * 60 * 60 });
}

// HttpOnly keeps the token away from page scripts; SameSite=Lax limits cross-site sends.
export function authCookieOptions(cfg: TokenConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.NODE_ENV === 'production',
    maxAge: cfg.JWT_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}
