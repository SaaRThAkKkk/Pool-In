import { Schema, model, type InferSchemaType } from 'mongoose';

// One document per OTP send. Only a keyed hash of the code is stored, never the code itself.
const otpCodeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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

export type OtpCodeRecord = InferSchemaType<typeof otpCodeSchema>;
export const OtpCode = model('OtpCode', otpCodeSchema);
