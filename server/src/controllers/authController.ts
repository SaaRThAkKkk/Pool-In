import type { RequestHandler } from 'express';
import { toPublicUser } from '../models/User.js';
import { registerUser } from '../services/auth/authService.js';
import { sendPhoneOtp, verifyPhoneOtp, type OtpDeps } from '../services/auth/otpService.js';
import { AUTH_COOKIE, authCookieOptions, signToken, type TokenConfig } from '../utils/token.js';
import type { RegisterInput } from '../validators/auth.js';
import type { VerifyOtpInput } from '../validators/phone.js';
import { User } from '../models/User.js';

export function makeAuthController(cfg: TokenConfig, otp: OtpDeps) {
  const register: RequestHandler = async (req, res) => {
    const user = await registerUser(req.body as RegisterInput);
    res.cookie(AUTH_COOKIE, signToken(user.id, cfg), authCookieOptions(cfg));
    res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
  };

  const me: RequestHandler = (req, res) => {
    res.json({ success: true, data: { user: toPublicUser(req.user!) } });
  };

  const sendOtp: RequestHandler = async (req, res) => {
    const result = await sendPhoneOtp(req.user!, otp);
    res.json({ success: true, data: result });
  };

  const verifyOtp: RequestHandler = async (req, res) => {
    await verifyPhoneOtp(req.user!, (req.body as VerifyOtpInput).code, otp);
    const fresh = await User.findById(req.user!._id);
    res.json({ success: true, data: { user: toPublicUser(fresh!) } });
  };

  return { register, me, sendOtp, verifyOtp };
}
