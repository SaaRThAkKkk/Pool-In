import { CarOwnerPool, type CarOwnerPoolDocument } from '../../models/CarOwnerPool.js';
import type { VehicleCategory } from '../../config/vehicles.js';
import { conflict, notFound } from '../../utils/errors.js';
import { luggageUnitsAvailable } from '../matching/luggage.js';

// Search results never guarantee a seat. When a join request is accepted, this is what actually reserves it.
// It re-checks status, seats and luggage space against the live record and updates them in ONE atomic
// database operation, so two requests for the last seat cannot both succeed.
//
// (Join requests themselves are not built yet; this is the step they will call.)
export async function reserveSeats(
  poolId: string,
  request: { seats: number; luggageUnits: number },
): Promise<CarOwnerPoolDocument> {
  const pool = await CarOwnerPool.findById(poolId);
  if (!pool) throw notFound('Pool not found');

  // Luggage capacity does not change after publishing, so it can be worked out here and enforced in the update below.
  const capacity = luggageUnitsAvailable({
    declaredUnits: pool.luggageSpaceUnits,
    vehicleCategory: pool.vehicle.category as VehicleCategory,
    ownLuggage: pool.luggage,
    usedUnits: 0,
  });

  const updated = await CarOwnerPool.findOneAndUpdate(
    {
      _id: poolId,
      status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      availableSeats: { $gte: request.seats },
      luggageUsedUnits: { $lte: capacity - request.luggageUnits },
    },
    [
      {
        $set: {
          availableSeats: { $subtract: ['$availableSeats', request.seats] },
          currentPassengerCount: { $add: ['$currentPassengerCount', request.seats] },
          luggageUsedUnits: { $add: ['$luggageUsedUnits', request.luggageUnits] },
        },
      },
      { $set: { status: { $cond: [{ $eq: ['$availableSeats', 0] }, 'FULL', 'PARTIALLY_FILLED'] } } },
    ],
    { returnDocument: 'after', updatePipeline: true },
  );

  if (!updated) {
    throw conflict('SEATS_UNAVAILABLE', 'This pool no longer has room for that many people and bags.');
  }
  return updated;
}
