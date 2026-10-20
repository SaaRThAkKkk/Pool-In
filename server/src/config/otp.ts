// Phone OTP policy. Values are initial product defaults, tune after real-world testing.
export const OTP = {
  LENGTH: 6,
  TTL_MS: 5 * 60 * 1000,
  MAX_ATTEMPTS: 5,
  RESEND_COOLDOWN_MS: 60 * 1000,
  MAX_SENDS_PER_HOUR: 5,
  // Documents are purged by a TTL index; validity is still checked explicitly via expiresAt.
  RETENTION_MS: 60 * 60 * 1000,
} as const;
