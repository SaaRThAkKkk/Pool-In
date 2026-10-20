import type { Env } from '../../config/env.js';
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

export function createSmsProvider(env: Pick<Env, 'SMS_PROVIDER'>): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return new ConsoleSmsProvider();
  }
}
// To go live: add a real provider (e.g. an India-compliant SMS gateway with a registered DLT template)
// implementing SmsProvider, add it to SMS_PROVIDER in config/env.ts, and map it here.
