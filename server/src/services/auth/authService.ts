import bcrypt from 'bcryptjs';
import { User, type UserDocument } from '../../models/User.js';
import { conflict } from '../../utils/errors.js';
import type { RegisterInput } from '../../validators/auth.js';

const BCRYPT_ROUNDS = 12;

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function registerUser(input: RegisterInput): Promise<UserDocument> {
  // Cheap pre-check for a friendly error; the unique indexes below are the real guarantee.
  const existing = await User.findOne({ $or: [{ email: input.email }, { phone: input.phone }] })
    .select('email')
    .lean();
  if (existing) throw duplicateError(existing.email === input.email);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    return await User.create({
      name: input.name,
      email: input.email,
      phone: input.phone,
      gender: input.gender,
      passwordHash,
    });
  } catch (err) {
    // Two simultaneous registrations can both pass the pre-check.
    if (isDuplicateKeyError(err)) throw duplicateError(Boolean(err.keyPattern?.email));
    throw err;
  }
}

function duplicateError(emailTaken: boolean) {
  return emailTaken
    ? conflict('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
    : conflict('PHONE_ALREADY_REGISTERED', 'An account with this phone number already exists');
}
