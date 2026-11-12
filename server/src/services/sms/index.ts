import type { Env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export interface SmsProvider {
  /** Deliver a one-time code. Must throw if delivery could not be confirmed as accepted by the provider. */
  sendOtp(phone: string, code: string): Promise<void>;
}

// DEVELOPMENT ONLY: no SMS is sent. The code is printed in the server terminal.
// Production startup is refused with this provider (see config/env.ts).
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    logger.warn(`[DEV SMS - nothing was actually sent] OTP for ${phone}: ${code}`);
  }
}

// For a hosted demo with no SMS gateway yet: nothing is sent and nothing is pretended. Asking for a code fails
// with a clear message, so a phone simply stays unverified.
export class DisabledSmsProvider implements SmsProvider {
  async sendOtp(): Promise<void> {
    throw new AppError(503, 'SMS_UNAVAILABLE', "Phone verification by SMS isn't available on this demo yet.");
  }
}

export function createSmsProvider(env: Pick<Env, 'SMS_PROVIDER'>): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider();
    case 'disabled':
      return new DisabledSmsProvider();
  }
}
// To go live: add a real provider (e.g. an India-compliant SMS gateway with a registered DLT template)
// implementing SmsProvider, add it to SMS_PROVIDER in config/env.ts, and map it here.
