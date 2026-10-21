import bcrypt from 'bcryptjs';
import { User, type UserDocument } from '../../models/User.js';
import { AppError, conflict, tooManyRequests } from '../../utils/errors.js';
import { isValidPhoneProof } from '../../utils/token.js';
import { LOGIN_POLICY } from '../../config/loginPolicy.js';
import type { LoginInput, RegisterInput } from '../../validators/auth.js';

const BCRYPT_ROUNDS = 12;

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function registerUser(input: RegisterInput, jwtSecret: string): Promise<UserDocument> {
  // A proof must match this exact phone; anything else is rejected rather than silently ignored.
  if (input.phoneProof !== undefined && !isValidPhoneProof(input.phoneProof, input.phone, jwtSecret)) {
    throw new AppError(
      400,
      'INVALID_PHONE_PROOF',
      'Your phone verification has expired or does not match this number. Verify the number again.',
    );
  }

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
      ...(input.phoneProof !== undefined ? { phoneVerifiedAt: new Date() } : {}),
    });
  } catch (err) {
    // Two simultaneous registrations can both pass the pre-check.
    if (isDuplicateKeyError(err)) throw duplicateError(Boolean(err.keyPattern?.email));
    throw err;
  }
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');

// Compared against when the email is unknown, so response time does not reveal whether an account exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', BCRYPT_ROUNDS));

export async function loginUser(input: LoginInput, now = new Date()): Promise<UserDocument> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user) {
    await bcrypt.compare(input.password, await getDummyHash());
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
    throw tooManyRequests(
      'ACCOUNT_TEMPORARILY_LOCKED',
      'Too many failed attempts. Try again in a few minutes.',
      { retryAfterSeconds },
    );
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    // Atomic increment so parallel guesses cannot dodge the counter.
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginAttempts: 1 } },
      { returnDocument: 'after' },
    );
    if (updated && updated.failedLoginAttempts >= LOGIN_POLICY.MAX_FAILED_ATTEMPTS) {
      await User.updateOne(
        { _id: user._id },
        { lockedUntil: new Date(now.getTime() + LOGIN_POLICY.LOCK_MS), failedLoginAttempts: 0 },
      );
    }
    throw invalidCredentials();
  }

  // Only reveal a suspension to someone who proved they own the account.
  if (user.accountStatus !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');

  if (user.failedLoginAttempts || user.lockedUntil) {
    await User.updateOne({ _id: user._id }, { failedLoginAttempts: 0, $unset: { lockedUntil: 1 } });
  }
  return user;
}

function duplicateError(emailTaken: boolean) {
  return emailTaken
    ? conflict('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
    : conflict('PHONE_ALREADY_REGISTERED', 'An account with this phone number already exists');
}
