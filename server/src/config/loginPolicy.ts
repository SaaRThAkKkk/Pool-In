// Brute-force protection for password login. Initial defaults, tune with real traffic.
export const LOGIN_POLICY = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCK_MS: 15 * 60 * 1000,
} as const;
