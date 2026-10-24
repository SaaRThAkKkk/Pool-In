import { MATCHING } from '../../config/matching.js';
import { ACTIVE_CAR_OWNER_STATUSES, POOL_POLICY } from '../../config/pools.js';
import { CabPool } from '../../models/CabPool.js';
import { CarOwnerPool, type CarOwnerPoolDocument } from '../../models/CarOwnerPool.js';
import { toCabPoolDto, toCarOwnerPoolDto, type PoolDto } from '../../models/poolDto.js';
import type { UserDocument } from '../../models/User.js';
import { notFound } from '../../utils/errors.js';
import { simplifyToMaxPoints } from '../../utils/geo.js';
import { logger } from '../../utils/logger.js';
import type { OwnVehicleInput } from '../../validators/pools.js';
import type { MapsProvider } from '../maps/types.js';
import { baseFields, checkArrivalWindow, duplicate, expireStaleSearches, isDuplicateKeyError, tooManyActive } from './poolCommon.js';

// The owner's drive from start to destination, worked out once at publish time and stored with the pool.
// If routing is unavailable the pool is still published, but it cannot be matched until it has a route.
async function plannedRoute(maps: MapsProvider, input: OwnVehicleInput) {
  const from = input.origin.coordinates;
  const to = input.destination.coordinates;
  if (!from || !to) return {};
  try {
    const route = await maps.getRoute(from, to, { detail: 'full' });
    const line = simplifyToMaxPoints(route.path, MATCHING.ROUTE_MAX_POINTS);
    if (line.length < 2) return {};
    return {
      route: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, computedAt: new Date() },
      routeLine: { type: 'LineString' as const, coordinates: line.map(([lat, lng]) => [lng, lat]) },
    };
  } catch (err) {
    logger.warn({ err }, 'could not store a route for a new pool; it will not be matchable yet');
    return {};
  }
}

// "I own the vehicle": saved in the CAR-OWNER section. Every server-controlled field (user, status, seat
// counters) is set here, never taken from the request.
export async function createCarOwnerPool(
  user: UserDocument,
  input: OwnVehicleInput,
  deps: { maps: MapsProvider },
  now = new Date(),
): Promise<CarOwnerPoolDocument> {
  checkArrivalWindow(input.arriveBy, now);

  const active = await CarOwnerPool.countDocuments({ userId: user._id, status: { $in: [...ACTIVE_CAR_OWNER_STATUSES] } });
  if (active >= POOL_POLICY.MAX_ACTIVE_PER_USER) throw tooManyActive();

  const route = await plannedRoute(deps.maps, input);

  try {
    return await CarOwnerPool.create({
      ...baseFields(user, input),
      ...route,
      vehicle: input.vehicle,
      seatsOffered: input.seats,
      availableSeats: input.seats,
      currentPassengerCount: 0,
      pricingMode: input.negotiable ? 'NEGOTIABLE' : 'FIXED',
      askingPrice: input.askingPrice,
      currency: 'INR',
      priceBasis: 'PER_PASSENGER',
      maxDriverDetourKm: input.maxDriverDetourKm ?? MATCHING.DEFAULT_MAX_DRIVER_DETOUR_KM,
      ...(input.luggageSpaceUnits !== undefined ? { luggageSpaceUnits: input.luggageSpaceUnits } : {}),
      status: 'OPEN',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicate();
    throw err;
  }
}

// Everything the user has created, from both sections, newest first.
export async function listMyPools(user: UserDocument, now = new Date()): Promise<PoolDto[]> {
  await expireStaleSearches(user._id, now);
  const [owner, cab] = await Promise.all([
    CarOwnerPool.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100),
    CabPool.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100),
  ]);
  const all: PoolDto[] = [...owner.map(toCarOwnerPoolDto), ...cab.map(toCabPoolDto)];
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
}

// Returns 404 (not 403) for someone else's pool so ids cannot be probed.
export async function getMyPool(user: UserDocument, id: string, now = new Date()): Promise<PoolDto> {
  await expireStaleSearches(user._id, now);
  const owner = await CarOwnerPool.findOne({ _id: id, userId: user._id });
  if (owner) return toCarOwnerPoolDto(owner);
  const cab = await CabPool.findOne({ _id: id, userId: user._id });
  if (cab) return toCabPoolDto(cab);
  throw notFound('Pool not found');
}

