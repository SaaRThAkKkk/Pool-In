import { Schema, model, type InferSchemaType } from 'mongoose';

export const OTP_PURPOSES = ['USER_PHONE', 'SIGNUP_PHONE'] as const;

// One document per OTP send. Only a keyed hash of the code is stored, never the code itself.
// USER_PHONE codes belong to a signed-in user; SIGNUP_PHONE codes belong to a phone number
// that is being verified before an account exists.
const otpCodeSchema = new Schema(
  {
    purpose: { type: String, enum: OTP_PURPOSES, default: 'USER_PHONE', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    phone: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    // Set when the code is consumed by a successful verification or superseded by a newer send.
    usedAt: { type: Date, default: null },
    purgeAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

otpCodeSchema.index({ userId: 1, createdAt: -1 });
otpCodeSchema.index({ purpose: 1, phone: 1, createdAt: -1 });

export type OtpCodeRecord = InferSchemaType<typeof otpCodeSchema>;
export const OtpCode = model('OtpCode', otpCodeSchema);
