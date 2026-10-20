import { z } from 'zod';
import { OTP } from '../config/otp.js';

export const verifyOtpSchema = z.object({
  code: z.string().trim().regex(new RegExp(`^\\d{${OTP.LENGTH}}$`), `Enter the ${OTP.LENGTH}-digit code`),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
