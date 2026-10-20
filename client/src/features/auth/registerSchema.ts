import { z } from 'zod'

// Mirrors the server rules for fast feedback; the server remains the source of truth.
export const GENDER_OPTIONS = [
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
] as const

// Same rule as the server: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9. Returns +91XXXXXXXXXX or null.
export function normalizeIndianPhone(input: string): string | null {
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(input.trim().replace(/[\s\-().]/g, ''))
  return m ? `+91${m[1]}` : null
}

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60, 'Name is too long'),
  email: z.string().trim().pipe(z.email('Enter a valid email address')),
  phone: z
    .string()
    .trim()
    .refine((v) => normalizeIndianPhone(v) !== null, 'Enter a valid 10-digit Indian mobile number'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number'),
  gender: z.enum(['prefer_not_to_say', 'female', 'male', 'other']),
})

export type RegisterForm = z.infer<typeof registerSchema>
