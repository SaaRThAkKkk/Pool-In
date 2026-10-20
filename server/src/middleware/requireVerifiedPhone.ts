import type { RequestHandler } from 'express';
import { AppError } from '../utils/errors.js';

// Policy guard for actions that book or join a ride. Must run after requireAuth.
// With the policy disabled (REQUIRE_VERIFIED_PHONE_FOR_BOOKING=false) it lets everyone through.
export function makeRequireVerifiedPhone(enabled: boolean): RequestHandler {
  return (req, _res, next) => {
    if (enabled && !req.user?.phoneVerifiedAt) {
      throw new AppError(
        403,
        'PHONE_NOT_VERIFIED',
        'Verify your phone number before booking or joining a ride.',
      );
    }
    next();
  };
}
