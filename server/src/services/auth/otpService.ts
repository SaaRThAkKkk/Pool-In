import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { OTP } from '../../config/otp.js';
import { OtpCode } from '../../models/OtpCode.js';
import { User, type UserDocument } from '../../models/User.js';
import type { SmsProvider } from '../sms/index.js';
import { badGateway, conflict, tooManyRequests, unprocessable } from '../../utils/errors.js';
import { signPhoneProof } from '../../utils/token.js';
import { logger } from '../../utils/logger.js';

export function maskPhone(phone: string): string {
  return `+91 ******${phone.slice(-4)}`;
}

function hashCode(secret: string, subjectKey: string, code: string): string {
  return createHmac('sha256', `otp:${secret}`).update(`${subjectKey}:${code}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface OtpDeps {
  sms: SmsProvider;
  secret: string;
}

// Who a code belongs to. `filter` selects that subject's codes (always scoped to the phone number).
interface Subject {
  filter: Record<string, unknown>;
  fields: Record<string, unknown>;
  key: string;
}

const userSubject = (user: UserDocument): Subject => ({
  filter: { purpose: 'USER_PHONE', userId: user._id, phone: user.phone },
  fields: { purpose: 'USER_PHONE', userId: user._id },
  key: `user:${user.id}:${user.phone}`,
});

const signupSubject = (phone: string): Subject => ({
  filter: { purpose: 'SIGNUP_PHONE', phone },
  fields: { purpose: 'SIGNUP_PHONE' },
  key: `signup:${phone}`,
});

async function sendCore(subject: Subject, phone: string, deps: OtpDeps, now: Date) {
  const latest = await OtpCode.findOne(subject.filter).sort({ createdAt: -1 }).lean();
  if (latest) {
    const waitMs = latest.createdAt.getTime() + OTP.RESEND_COOLDOWN_MS - now.getTime();
    if (waitMs > 0) {
      const retryAfterSeconds = Math.ceil(waitMs / 1000);
      throw tooManyRequests('OTP_RESEND_TOO_SOON', `Please wait ${retryAfterSeconds}s before requesting another code`, {
        retryAfterSeconds,
      });
    }
  }

  const sentLastHour = await OtpCode.countDocuments({
    ...subject.filter,
    createdAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  if (sentLastHour >= OTP.MAX_SENDS_PER_HOUR) {
    throw tooManyRequests('OTP_SEND_LIMIT', 'Too many codes requested. Please try again later.');
  }

  // Only the newest code is ever valid.
  await OtpCode.updateMany({ ...subject.filter, usedAt: null }, { usedAt: now });

  const code = randomInt(0, 10 ** OTP.LENGTH).toString().padStart(OTP.LENGTH, '0');
  const record = await OtpCode.create({
    ...subject.fields,
    phone,
    codeHash: hashCode(deps.secret, subject.key, code),
    expiresAt: new Date(now.getTime() + OTP.TTL_MS),
    purgeAt: new Date(now.getTime() + OTP.RETENTION_MS),
  });

  try {
    await deps.sms.sendOtp(phone, code);
  } catch (err) {
    // Don't leave a usable code (or consume the cooldown) for a message that never went out.
    await OtpCode.deleteOne({ _id: record._id });
    logger.error({ err }, 'SMS delivery failed');
    throw badGateway('SMS_DELIVERY_FAILED', 'We could not send the code. Please try again shortly.');
  }

  return {
    maskedPhone: maskPhone(phone),
    expiresAt: record.expiresAt,
    resendAvailableAt: new Date(now.getTime() + OTP.RESEND_COOLDOWN_MS),
  };
}

async function verifyCore(subject: Subject, code: string, deps: OtpDeps, now: Date) {
  const active = await OtpCode.findOne({ ...subject.filter, usedAt: null }).sort({ createdAt: -1 }).lean();
  if (!active || active.expiresAt <= now) {
    throw unprocessable('OTP_EXPIRED_OR_MISSING', 'This code has expired or was not requested. Request a new code.');
  }

  // Atomically spend one attempt; parallel guesses cannot exceed MAX_ATTEMPTS.
  const attempt = await OtpCode.findOneAndUpdate(
    { _id: active._id, usedAt: null, expiresAt: { $gt: now }, attempts: { $lt: OTP.MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!attempt) {
    throw tooManyRequests('OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.');
  }

  if (!safeEqualHex(attempt.codeHash, hashCode(deps.secret, subject.key, code))) {
    const attemptsRemaining = Math.max(0, OTP.MAX_ATTEMPTS - attempt.attempts);
    throw unprocessable('OTP_INVALID', 'Incorrect code', { attemptsRemaining });
  }

  // Single-use: only one request can consume a correct code.
  const claimed = await OtpCode.findOneAndUpdate({ _id: attempt._id, usedAt: null }, { usedAt: now });
  if (!claimed) throw unprocessable('OTP_EXPIRED_OR_MISSING', 'This code has already been used. Request a new code.');
}

// ---- Signed-in user ("verify later") ----

export async function sendPhoneOtp(user: UserDocument, deps: OtpDeps, now = new Date()) {
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');
  return sendCore(userSubject(user), user.phone, deps, now);
}

export async function verifyPhoneOtp(user: UserDocument, code: string, deps: OtpDeps, now = new Date()) {
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');
  await verifyCore(userSubject(user), code, deps, now);
  await User.updateOne({ _id: user._id }, { phoneVerifiedAt: now });
}

// ---- Before an account exists (verify during registration) ----

export async function sendSignupOtp(phone: string, deps: OtpDeps, now = new Date()) {
  if (await User.exists({ phone })) {
    throw conflict('PHONE_ALREADY_REGISTERED', 'An account with this phone number already exists');
  }
  return sendCore(signupSubject(phone), phone, deps, now);
}

// Returns a short-lived proof, bound to this phone, that registration accepts instead of a second OTP.
export async function verifySignupOtp(phone: string, code: string, deps: OtpDeps, now = new Date()) {
  await verifyCore(signupSubject(phone), code, deps, now);
  return signPhoneProof(phone, deps.secret);
}
