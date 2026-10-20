import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const USER_ROLES = ['user', 'admin'] as const;
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
// Minimal, non-sensitive status only (PRD §13.1). Real verification is a later phase.
export const VERIFICATION_STATUSES = ['UNVERIFIED', 'PENDING', 'VERIFIED'] as const;
// Self-declared; used only for the women-only pool preference. Not identity verification.
export const GENDERS = ['female', 'male', 'other', 'prefer_not_to_say'] as const;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true, unique: true },
    // select:false so the hash is never loaded unless explicitly requested (login).
    passwordHash: { type: String, required: true, select: false },
    gender: { type: String, enum: GENDERS, default: 'prefer_not_to_say' },
    role: { type: String, enum: USER_ROLES, default: 'user' },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'ACTIVE' },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'UNVERIFIED' },
    profileImage: { type: String },
  },
  { timestamps: true },
);

export type UserRecord = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserRecord>;
export const User = model('User', userSchema);

// The only shape of a user that may leave the server (never includes passwordHash).
export function toPublicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    role: user.role,
    verificationStatus: user.verificationStatus,
    createdAt: user.createdAt,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;
