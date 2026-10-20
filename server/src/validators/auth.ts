import { z } from 'zod';
import { GENDERS } from '../models/User.js';

// Indian mobile numbers: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9.
// Stored in E.164 form (+91XXXXXXXXXX) so uniqueness checks are reliable.
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalized = normalizeIndianPhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return normalized;
  });

// bcrypt only uses the first 72 bytes, so cap the length instead of silently truncating.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  phone: phoneSchema,
  password,
  gender: z.enum(GENDERS).default('prefer_not_to_say'),
  // Optional proof from the signup OTP flow. Never trusted without checking the signature and phone binding.
  phoneProof: z.string().max(2000).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
