import { Types } from 'mongoose';
import { MATCHING } from '../../config/matching.js';
import { CabPool, type CabPoolDocument } from '../../models/CabPool.js';
import { CarOwnerPool, type CarOwnerPoolDocument } from '../../models/CarOwnerPool.js';
import { boxAround, polylineLengths, projectOntoPolyline, type LatLngTuple } from '../../utils/geo.js';
import type { CandidateRepository } from './matcher.js';
import { luggageUnits, luggageUnitsAvailable } from './luggage.js';
import type { OwnerPoolCandidate, PassengerRequest, PeerRequest } from './types.js';
import type { VehicleCategory } from '../../config/vehicles.js';

const MIN = 60_000;

// The shape of a pool the matching code needs. A pool with no stored route (published while routing was down,
// or before routes were stored) cannot be matched, so it is skipped rather than guessed at.
export function toOwnerCandidate(pool: CarOwnerPoolDocument): OwnerPoolCandidate | null {
  const o = pool.origin.coordinates;
  const d = pool.destination.coordinates;
  if (!o || !d || !pool.route?.distanceMeters || !pool.route.durationSeconds || !pool.routeLine?.coordinates?.length) return null;

  return {
    id: pool._id.toString(),
    userId: pool.userId.toString(),
    originLabel: pool.origin.label,
    destinationLabel: pool.destination.label,
    origin: { lat: o.lat, lng: o.lng },
    destination: { lat: d.lat, lng: d.lng },
    arriveBy: pool.arriveBy,
    availableSeats: pool.availableSeats,
    luggageUnitsAvailable: luggageUnitsAvailable({
      declaredUnits: pool.luggageSpaceUnits,
      vehicleCategory: pool.vehicle.category as VehicleCategory,
      ownLuggage: pool.luggage,
      usedUnits: pool.luggageUsedUnits,
    }),
    askingPrice: pool.askingPrice,
    negotiable: pool.pricingMode === 'NEGOTIABLE',
    maxDriverDetourKm: pool.maxDriverDetourKm ?? MATCHING.DEFAULT_MAX_DRIVER_DETOUR_KM,
    vehicle: { category: pool.vehicle.category, make: pool.vehicle.make, model: pool.vehicle.model },
    route: {
      distanceMeters: pool.route.distanceMeters,
      durationSeconds: pool.route.durationSeconds,
      // Stored as GeoJSON [lng, lat]; the matching code works in [lat, lng].
      line: (pool.routeLine.coordinates as unknown as number[][]).map(([lng, lat]) => [lat!, lng!] as LatLngTuple),
    },
    confirmedStops: (pool.confirmedStops ?? [])
      .filter((s) => s.pickup?.lat !== undefined && s.dropoff?.lat !== undefined)
      .map((s) => ({
        seats: s.seats ?? 1,
        pickup: { lat: s.pickup!.lat!, lng: s.pickup!.lng! },
        dropoff: { lat: s.dropoff!.lat!, lng: s.dropoff!.lng! },
      })),
  };
}

export function toPassengerRequest(doc: CabPoolDocument): PeerRequest | null {
  const o = doc.origin.coordinates;
  const d = doc.destination.coordinates;
  if (!o || !d) return null;
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    origin: { lat: o.lat, lng: o.lng },
    destination: { lat: d.lat, lng: d.lng },
    arriveBy: doc.arriveBy,
    people: doc.peopleCount,
    luggageUnits: luggageUnits(doc.luggage),
    maxPickupTravelKm: doc.maxPickupTravelKm ?? MATCHING.DEFAULT_MAX_PICKUP_TRAVEL_KM,
    ...(doc.maxDropoffTravelKm != null ? { maxDropoffTravelKm: doc.maxDropoffTravelKm } : {}),
    ...(doc.maxBudget != null ? { maxBudget: doc.maxBudget } : {}),
  };
}

// "Not this person's own": only when the id is a real database id (it always is outside of tests).
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const excluding = (field: string, id: string | undefined) =>
  id && OBJECT_ID.test(id) ? { [field]: { $ne: new Types.ObjectId(id) } } : {};

const polygon = (center: { lat: number; lng: number }, radiusKm: number) => ({
  type: 'Polygon' as const,
  coordinates: [boxAround(center, radiusKm)],
});

export class MongoCandidateRepository implements CandidateRepository {
  // Car-owner pools worth checking with real routing. The database narrows by status, seats, time and "does the
  // route pass near both the pickup and the destination" (a geospatial query on the stored route line). The
  // straight-line closest ones are returned first, capped, so routing is only spent where it could succeed.
  async ownerPools(
    request: PassengerRequest,
    opts: { now: Date; createdAfter?: Date; poolIds?: string[] },
  ): Promise<OwnerPoolCandidate[]> {
    const pickupRadiusKm = Math.max(MATCHING.PREFILTER_PICKUP_RADIUS_KM, request.maxPickupTravelKm);
    const dropoffRadiusKm =
      request.maxDropoffTravelKm === undefined
        ? MATCHING.PREFILTER_DROPOFF_RADIUS_KM
        : Math.max(MATCHING.PREFILTER_PICKUP_RADIUS_KM, request.maxDropoffTravelKm);

    const pa = request.arriveBy.getTime();
    const docs = await CarOwnerPool.find({
      status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      availableSeats: { $gte: request.people },
      ...excluding('userId', request.userId),
      // The owner reaches their destination after dropping the passenger, so not before the earliest acceptable drop-off.
      arriveBy: { $gte: new Date(pa - MATCHING.MAX_EARLY_ARRIVAL_MIN * MIN), $lte: new Date(pa + MATCHING.TIME_PREFILTER_SLACK_MIN * MIN) },
      $and: [
        { routeLine: { $geoIntersects: { $geometry: polygon(request.origin, pickupRadiusKm) } } },
        { routeLine: { $geoIntersects: { $geometry: polygon(request.destination, dropoffRadiusKm) } } },
      ],
      ...(opts.createdAfter ? { createdAt: { $gt: opts.createdAfter } } : {}),
      ...(opts.poolIds ? { _id: { $in: opts.poolIds.filter((id) => OBJECT_ID.test(id)).map((id) => new Types.ObjectId(id)) } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(MATCHING.MAX_CANDIDATES * 3);

    return docs
      .map(toOwnerCandidate)
      .filter((c): c is OwnerPoolCandidate => c !== null)
      .map((c) => {
        const lengths = polylineLengths(c.route.line);
        const gap =
          (projectOntoPolyline(c.route.line, request.origin, lengths)?.distanceMeters ?? Infinity) +
          (projectOntoPolyline(c.route.line, request.destination, lengths)?.distanceMeters ?? Infinity);
        return { c, gap };
      })
      .sort((a, b) => a.gap - b.gap)
      .slice(0, MATCHING.MAX_CANDIDATES)
      .map(({ c }) => c);
  }

  // The pools whose route passes closest to the passenger's start, however badly they fit (the caller explains why).
  // Only pools that are open and have not left yet; the passenger's own pools are left out.
  async nearestOwnerPools(request: PassengerRequest, opts: { now: Date; limit: number }): Promise<OwnerPoolCandidate[]> {
    const docs = await CarOwnerPool.find({
      status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      ...excluding('userId', request.userId),
      arriveBy: { $gt: opts.now },
      routeLine: {
        $near: {
          $geometry: { type: 'Point', coordinates: [request.origin.lng, request.origin.lat] },
          $maxDistance: MATCHING.NEAREST_SEARCH_RADIUS_KM * 1000,
        },
      },
    }).limit(opts.limit * 3);

    return docs
      .map(toOwnerCandidate)
      .filter((c): c is OwnerPoolCandidate => c !== null)
      .slice(0, opts.limit);
  }

  // Other passengers' requests that could share a cab: the open ones, and those still in their own five-minute
  // search (they are looking for a ride just as much, so the second person to search can find the first).
  async peerRequests(request: PassengerRequest, opts: { now: Date }): Promise<PeerRequest[]> {
    void opts;
    const pa = request.arriveBy.getTime();
    const window = MATCHING.CAB.TIME_WINDOW_MIN * MIN;

    const docs = await CabPool.find({
      status: { $in: ['OPEN', 'SEARCHING'] },
      ...excluding('userId', request.userId),
      ...excluding('_id', request.id),
      peopleCount: { $lte: MATCHING.CAB.MAX_PEOPLE - request.people },
      arriveBy: { $gte: new Date(pa - window), $lte: new Date(pa + window) },
      // Their pickup must be somewhere both of us could reach; their destination close to ours.
      originPoint: { $geoWithin: { $geometry: polygon(request.origin, request.maxPickupTravelKm + MATCHING.MAX_PICKUP_TRAVEL_KM) } },
      destinationPoint: { $geoWithin: { $geometry: polygon(request.destination, MATCHING.CAB.MAX_DESTINATION_SEPARATION_KM) } },
    })
      .sort({ createdAt: -1 })
      .limit(MATCHING.MAX_CANDIDATES);

    return docs.map(toPassengerRequest).filter((p): p is PeerRequest => p !== null);
  }
}
