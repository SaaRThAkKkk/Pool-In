import { ACTIVE_RIDE_STATUSES, RIDE_POLICY } from '../../config/rides.js';
import { Ride, toPoint, type RideDocument } from '../../models/Ride.js';
import type { UserDocument } from '../../models/User.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { normalizeLabel, type CreateRideInput } from '../../validators/rides.js';

const dedupeKey = (i: CreateRideInput) =>
  [i.origin.label, i.destination.label].map(normalizeLabel).join('|') + `|${i.departureAt?.getTime() ?? 'any'}`;

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Creates an owner-listed private-vehicle ride. Every server-controlled field (owner, status, seat
// counters, type) is set here, never taken from the request.
export async function createOwnerRide(
  owner: UserDocument,
  input: CreateRideInput,
  now = new Date(),
): Promise<RideDocument> {
  if (input.departureAt) {
    const lead = input.departureAt.getTime() - now.getTime();
    if (lead < RIDE_POLICY.MIN_LEAD_MS || lead > RIDE_POLICY.MAX_LEAD_MS) {
      const message =
        lead < RIDE_POLICY.MIN_LEAD_MS
          ? `Departure must be at least ${RIDE_POLICY.MIN_LEAD_MS / 60_000} minutes from now`
          : `Departure can be at most ${RIDE_POLICY.MAX_LEAD_MS / 86_400_000} days from now`;
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', [{ path: 'departureAt', message }]);
    }
  }

  const active = await Ride.countDocuments({
    ownerUserId: owner._id,
    rideStatus: { $in: [...ACTIVE_RIDE_STATUSES] },
  });
  if (active >= RIDE_POLICY.MAX_ACTIVE_PER_OWNER) {
    throw conflict(
      'TOO_MANY_ACTIVE_RIDES',
      `You can have at most ${RIDE_POLICY.MAX_ACTIVE_PER_OWNER} active pools. Cancel or complete one first.`,
    );
  }

  try {
    return await Ride.create({
      rideType: 'OWNER_VEHICLE',
      ownerUserId: owner._id,
      origin: input.origin,
      destination: input.destination,
      originPoint: toPoint(input.origin.coordinates),
      destinationPoint: toPoint(input.destination.coordinates),
      departureAt: input.departureAt,
      vehicle: input.vehicle,
      passengerCapacity: input.seats,
      availableSeats: input.seats,
      currentPassengerCount: 0,
      pricingMode: input.negotiable ? 'NEGOTIABLE' : 'FIXED',
      askingPrice: input.askingPrice,
      currency: 'INR',
      priceBasis: 'PER_PASSENGER',
      rideStatus: 'OPEN',
      dedupeKey: dedupeKey(input),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw conflict('DUPLICATE_RIDE', 'You already have a pool for this route at this time');
    }
    throw err;
  }
}

export function listOwnerRides(owner: UserDocument): Promise<RideDocument[]> {
  // Newest first: not every pool has a departure time.
  return Ride.find({ ownerUserId: owner._id }).sort({ createdAt: -1 }).limit(100);
}

// Returns 404 (not 403) for someone else's ride so ids cannot be probed.
export async function getOwnerRide(owner: UserDocument, id: string): Promise<RideDocument> {
  const ride = await Ride.findOne({ _id: id, ownerUserId: owner._id });
  if (!ride) throw notFound('Pool not found');
  return ride;
}
