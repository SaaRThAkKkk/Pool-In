import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { OTP } from '../../config/otp.js';
import { OtpCode } from '../../models/OtpCode.js';
import { User, type UserDocument } from '../../models/User.js';
import type { SmsProvider } from '../sms/index.js';
import { badGateway, conflict, tooManyRequests, unprocessable } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export function maskPhone(phone: string): string {
  return `+91 ******${phone.slice(-4)}`;
}

function hashCode(secret: string, userId: string, phone: string, code: string): string {
  return createHmac('sha256', `otp:${secret}`).update(`${userId}:${phone}:${code}`).digest('hex');
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

export async function sendPhoneOtp(user: UserDocument, deps: OtpDeps, now = new Date()) {
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');

  const latest = await OtpCode.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
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
    userId: user._id,
    createdAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
  });
  if (sentLastHour >= OTP.MAX_SENDS_PER_HOUR) {
    throw tooManyRequests('OTP_SEND_LIMIT', 'Too many codes requested. Please try again later.');
  }

  // Only the newest code is ever valid.
  await OtpCode.updateMany({ userId: user._id, usedAt: null }, { usedAt: now });

  const code = randomInt(0, 10 ** OTP.LENGTH).toString().padStart(OTP.LENGTH, '0');
  const record = await OtpCode.create({
    userId: user._id,
    phone: user.phone,
    codeHash: hashCode(deps.secret, user.id, user.phone, code),
    expiresAt: new Date(now.getTime() + OTP.TTL_MS),
    purgeAt: new Date(now.getTime() + OTP.RETENTION_MS),
  });

  try {
    await deps.sms.sendOtp(user.phone, code);
  } catch (err) {
    // Don't leave a usable code (or consume the user's cooldown) for a message that never went out.
    await OtpCode.deleteOne({ _id: record._id });
    logger.error({ err, userId: user.id }, 'SMS delivery failed');
    throw badGateway('SMS_DELIVERY_FAILED', 'We could not send the code. Please try again shortly.');
  }

  return {
    maskedPhone: maskPhone(user.phone),
    expiresAt: record.expiresAt,
    resendAvailableAt: new Date(now.getTime() + OTP.RESEND_COOLDOWN_MS),
  };
}

export async function verifyPhoneOtp(user: UserDocument, code: string, deps: OtpDeps, now = new Date()) {
  if (user.phoneVerifiedAt) throw conflict('PHONE_ALREADY_VERIFIED', 'Your phone number is already verified');

  const active = await OtpCode.findOne({ userId: user._id, phone: user.phone, usedAt: null })
    .sort({ createdAt: -1 })
    .lean();
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

  if (!safeEqualHex(attempt.codeHash, hashCode(deps.secret, user.id, user.phone, code))) {
    const attemptsRemaining = Math.max(0, OTP.MAX_ATTEMPTS - attempt.attempts);
    throw unprocessable('OTP_INVALID', 'Incorrect code', { attemptsRemaining });
  }

  // Single-use: only one request can consume a correct code.
  const claimed = await OtpCode.findOneAndUpdate({ _id: attempt._id, usedAt: null }, { usedAt: now });
  if (!claimed) throw unprocessable('OTP_EXPIRED_OR_MISSING', 'This code has already been used. Request a new code.');

  await User.updateOne({ _id: user._id }, { phoneVerifiedAt: now });
}
