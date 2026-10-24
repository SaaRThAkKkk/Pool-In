import type { Types } from 'mongoose';
import { POOL_POLICY } from '../../config/pools.js';
import { CabPool } from '../../models/CabPool.js';
import { toPoint } from '../../models/poolParts.js';
import type { UserDocument } from '../../models/User.js';
import { AppError, conflict } from '../../utils/errors.js';
import { normalizeLabel, type OwnVehicleInput, type PoolCabInput } from '../../validators/pools.js';

// Helpers shared by the owner-pool and cab-search services.

export type RouteInput = OwnVehicleInput | PoolCabInput;

export const dedupeKey = (i: RouteInput) =>
  [i.origin.label, i.destination.label].map(normalizeLabel).join('|') + `|${i.arriveBy.getTime()}`;

export const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export function checkArrivalWindow(arriveBy: Date, now: Date) {
  const lead = arriveBy.getTime() - now.getTime();
  if (lead >= POOL_POLICY.MIN_LEAD_MS && lead <= POOL_POLICY.MAX_LEAD_MS) return;
  const message =
    lead < POOL_POLICY.MIN_LEAD_MS
      ? `Arrival time must be at least ${POOL_POLICY.MIN_LEAD_MS / 60_000} minutes from now`
      : `Arrival time can be at most ${POOL_POLICY.MAX_LEAD_MS / 86_400_000} days from now`;
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', [{ path: 'arriveBy', message }]);
}

export const tooManyActive = () =>
  conflict(
    'TOO_MANY_ACTIVE_POOLS',
    `You can have at most ${POOL_POLICY.MAX_ACTIVE_PER_USER} active pools of this kind. Cancel or complete one first.`,
  );
export const duplicate = () => conflict('DUPLICATE_POOL', 'You already have a pool for this route and arrival time');

export const baseFields = (user: UserDocument, i: RouteInput) => ({
  userId: user._id,
  origin: i.origin,
  destination: i.destination,
  originPoint: toPoint(i.origin.coordinates),
  destinationPoint: toPoint(i.destination.coordinates),
  arriveBy: i.arriveBy,
  luggage: i.luggage,
  dedupeKey: dedupeKey(i),
});

// When a search's five minutes are up with no car-owner pool, the request is posted as an open passenger-pooling
// request, so other passengers can find it and match with it. Done lazily whenever searches are read or counted,
// so no background job is needed. (SEARCH_TIMED_OUT is the older, intermediate state; it is treated the same way.)
export async function expireStaleSearches(userId: Types.ObjectId | undefined, now: Date): Promise<void> {
  const own = userId ? { userId } : {};
  await CabPool.updateMany({ status: 'SEARCHING', searchExpiresAt: { $lte: now }, ...own }, { status: 'OPEN', matches: [] });
  await CabPool.updateMany({ status: 'SEARCH_TIMED_OUT', ...own }, { status: 'OPEN', matches: [] });
}
