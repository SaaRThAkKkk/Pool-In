import type { RequestHandler } from 'express';
import { User, toPublicUser } from '../models/User.js';
import { loginUser, registerUser } from '../services/auth/authService.js';
import {
  sendPhoneOtp,
  sendSignupOtp,
  verifyPhoneOtp,
  verifySignupOtp,
  type OtpDeps,
} from '../services/auth/otpService.js';
import {
  AUTH_COOKIE,
  PHONE_PROOF_TTL_SECONDS,
  authCookieOptions,
  signToken,
  type TokenConfig,
} from '../utils/token.js';
import type { LoginInput, RegisterInput } from '../validators/auth.js';
import type { SignupOtpVerifyInput, VerifyOtpInput } from '../validators/phone.js';

export function makeAuthController(cfg: TokenConfig, otp: OtpDeps) {
  const register: RequestHandler = async (req, res) => {
    const user = await registerUser(req.body as RegisterInput, cfg.JWT_SECRET);
    res.cookie(AUTH_COOKIE, signToken(user.id, cfg), authCookieOptions(cfg));
    res.status(201).json({ success: true, data: { user: toPublicUser(user) } });
  };

  const login: RequestHandler = async (req, res) => {
    const user = await loginUser(req.body as LoginInput);
    res.cookie(AUTH_COOKIE, signToken(user.id, cfg), authCookieOptions(cfg));
    res.json({ success: true, data: { user: toPublicUser(user) } });
  };

  // Clears the browser cookie. Tokens are stateless, so this ends the session on this browser only.
  const logout: RequestHandler = (_req, res) => {
    const { maxAge: _maxAge, ...options } = authCookieOptions(cfg);
    res.clearCookie(AUTH_COOKIE, options);
    res.json({ success: true, data: {} });
  };

  const me: RequestHandler = (req, res) => {
    res.json({ success: true, data: { user: toPublicUser(req.user!) } });
  };

  // Signed-in users verifying later
  const sendOtp: RequestHandler = async (req, res) => {
    const result = await sendPhoneOtp(req.user!, otp);
    res.json({ success: true, data: result });
  };

  const verifyOtp: RequestHandler = async (req, res) => {
    await verifyPhoneOtp(req.user!, (req.body as VerifyOtpInput).code, otp);
    const fresh = await User.findById(req.user!._id);
    res.json({ success: true, data: { user: toPublicUser(fresh!) } });
  };

  // Verifying during registration (no account yet)
  const sendSignupOtpHandler: RequestHandler = async (req, res) => {
    const result = await sendSignupOtp((req.body as { phone: string }).phone, otp);
    res.json({ success: true, data: result });
  };

  const verifySignupOtpHandler: RequestHandler = async (req, res) => {
    const { phone, code } = req.body as SignupOtpVerifyInput;
    const phoneProof = await verifySignupOtp(phone, code, otp);
    res.json({ success: true, data: { phoneProof, phone, expiresInSeconds: PHONE_PROOF_TTL_SECONDS } });
  };

  return {
    register,
    login,
    logout,
    me,
    sendOtp,
    verifyOtp,
    sendSignupOtp: sendSignupOtpHandler,
    verifySignupOtp: verifySignupOtpHandler,
  };
}
