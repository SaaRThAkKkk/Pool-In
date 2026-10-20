import { z } from 'zod';
import { OTP } from '../config/otp.js';
import { phoneSchema } from './auth.js';

const code = z.string().trim().regex(new RegExp(`^\\d{${OTP.LENGTH}}$`), `Enter the ${OTP.LENGTH}-digit code`);

export const verifyOtpSchema = z.object({ code });
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const signupOtpSendSchema = z.object({ phone: phoneSchema });
export const signupOtpVerifySchema = z.object({ phone: phoneSchema, code });
export type SignupOtpVerifyInput = z.infer<typeof signupOtpVerifySchema>;
