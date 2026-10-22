import { ACTIVE_CAB_STATUSES, ACTIVE_CAR_OWNER_STATUSES, POOL_POLICY } from '../../config/pools.js';
import { CabPool, type CabPoolDocument } from '../../models/CabPool.js';
import { CarOwnerPool, type CarOwnerPoolDocument } from '../../models/CarOwnerPool.js';
import { toCabPoolDto, toCarOwnerPoolDto, type PoolDto } from '../../models/poolDto.js';
import { toPoint } from '../../models/poolParts.js';
import type { UserDocument } from '../../models/User.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { normalizeLabel, type OwnVehicleInput, type PoolCabInput } from '../../validators/pools.js';
import type { MatchOutcome, PoolMatcher } from './matching.js';

type RouteInput = OwnVehicleInput | PoolCabInput;

const dedupeKey = (i: RouteInput) =>
  [i.origin.label, i.destination.label].map(normalizeLabel).join('|') + `|${i.arriveBy.getTime()}`;

const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

function checkArrivalWindow(arriveBy: Date, now: Date) {
  const lead = arriveBy.getTime() - now.getTime();
  if (lead >= POOL_POLICY.MIN_LEAD_MS && lead <= POOL_POLICY.MAX_LEAD_MS) return;
  const message =
    lead < POOL_POLICY.MIN_LEAD_MS
      ? `Arrival time must be at least ${POOL_POLICY.MIN_LEAD_MS / 60_000} minutes from now`
      : `Arrival time can be at most ${POOL_POLICY.MAX_LEAD_MS / 86_400_000} days from now`;
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', [{ path: 'arriveBy', message }]);
}

const tooManyActive = () =>
  conflict(
    'TOO_MANY_ACTIVE_POOLS',
    `You can have at most ${POOL_POLICY.MAX_ACTIVE_PER_USER} active pools of this kind. Cancel or complete one first.`,
  );
const duplicate = () => conflict('DUPLICATE_POOL', 'You already have a pool for this route and arrival time');

const baseFields = (user: UserDocument, i: RouteInput) => ({
  userId: user._id,
  origin: i.origin,
  destination: i.destination,
  originPoint: toPoint(i.origin.coordinates),
  destinationPoint: toPoint(i.destination.coordinates),
  arriveBy: i.arriveBy,
  luggage: i.luggage,
  dedupeKey: dedupeKey(i),
});

// "I own the vehicle": saved in the CAR-OWNER section. Every server-controlled field (user, status, seat
// counters) is set here, never taken from the request.
export async function createCarOwnerPool(
  user: UserDocument,
  input: OwnVehicleInput,
  now = new Date(),
): Promise<CarOwnerPoolDocument> {
  checkArrivalWindow(input.arriveBy, now);

  const active = await CarOwnerPool.countDocuments({ userId: user._id, status: { $in: [...ACTIVE_CAR_OWNER_STATUSES] } });
  if (active >= POOL_POLICY.MAX_ACTIVE_PER_USER) throw tooManyActive();

  try {
    return await CarOwnerPool.create({
      ...baseFields(user, input),
      vehicle: input.vehicle,
      seatsOffered: input.seats,
      availableSeats: input.seats,
      currentPassengerCount: 0,
      pricingMode: input.negotiable ? 'NEGOTIABLE' : 'FIXED',
      askingPrice: input.askingPrice,
      currency: 'INR',
      priceBasis: 'PER_PASSENGER',
      status: 'OPEN',
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicate();
    throw err;
  }
}

export type CabOutcome =
  | { outcome: 'MATCHES_FOUND'; matching: MatchOutcome; pool?: undefined }
  | { outcome: 'REQUEST_CREATED'; matching: MatchOutcome; pool: CabPoolDocument };

// "Pool a cab": first search for a matching pool in BOTH sections; only when none is found, save a new
// request in the CAB section. (Matching itself is a placeholder for now.)
export async function poolACab(
  user: UserDocument,
  input: PoolCabInput,
  matcher: PoolMatcher,
  now = new Date(),
): Promise<CabOutcome> {
  checkArrivalWindow(input.arriveBy, now);

  const matching = await matcher.findMatches({
    userId: user.id,
    origin: input.origin,
    destination: input.destination,
    arriveBy: input.arriveBy,
    luggage: input.luggage,
    people: input.people,
  });
  if (matching.matches.length > 0) return { outcome: 'MATCHES_FOUND', matching };

  const active = await CabPool.countDocuments({ userId: user._id, status: { $in: [...ACTIVE_CAB_STATUSES] } });
  if (active >= POOL_POLICY.MAX_ACTIVE_PER_USER) throw tooManyActive();

  try {
    const pool = await CabPool.create({ ...baseFields(user, input), peopleCount: input.people, status: 'OPEN' });
    return { outcome: 'REQUEST_CREATED', matching, pool };
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicate();
    throw err;
  }
}

// Everything the user has created, from both sections, newest first.
export async function listMyPools(user: UserDocument): Promise<PoolDto[]> {
  const [owner, cab] = await Promise.all([
    CarOwnerPool.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100),
    CabPool.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100),
  ]);
  const all: PoolDto[] = [...owner.map(toCarOwnerPoolDto), ...cab.map(toCabPoolDto)];
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
}

// Returns 404 (not 403) for someone else's pool so ids cannot be probed.
export async function getMyPool(user: UserDocument, id: string): Promise<PoolDto> {
  const owner = await CarOwnerPool.findOne({ _id: id, userId: user._id });
  if (owner) return toCarOwnerPoolDto(owner);
  const cab = await CabPool.findOne({ _id: id, userId: user._id });
  if (cab) return toCabPoolDto(cab);
  throw notFound('Pool not found');
}
