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

// Proof that a phone number passed OTP verification before registration.
// Signed with a key derived from (not equal to) the session secret, so it can never act as a login token
// and a login token can never act as a proof.
export const PHONE_PROOF_TTL_SECONDS = 15 * 60;
const proofKey = (secret: string) => `phone-proof:${secret}`;

export function signPhoneProof(phone: string, secret: string): string {
  return jwt.sign({ typ: 'phone-proof', phone }, proofKey(secret), { expiresIn: PHONE_PROOF_TTL_SECONDS });
}

export function isValidPhoneProof(token: string, phone: string, secret: string): boolean {
  try {
    const payload = jwt.verify(token, proofKey(secret));
    return typeof payload !== 'string' && payload.typ === 'phone-proof' && payload.phone === phone;
  } catch {
    return false;
  }
}
