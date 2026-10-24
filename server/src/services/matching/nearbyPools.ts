import { polylineLengths, projectOntoPolyline } from '../../utils/geo.js';
import type { NearbyPool, OwnerPoolCandidate, PassengerRequest, RejectReason } from './types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;
const km = (m: number) => round1(m / 1000);

// How far a pool's route passes from the passenger's start and destination, in a straight line.
export function gapsToRoute(request: PassengerRequest, pool: OwnerPoolCandidate) {
  const lengths = polylineLengths(pool.route.line);
  return {
    startGapKm: km(projectOntoPolyline(pool.route.line, request.origin, lengths)?.distanceMeters ?? Infinity),
    endGapKm: km(projectOntoPolyline(pool.route.line, request.destination, lengths)?.distanceMeters ?? Infinity),
  };
}

// Plain-language reasons a pool that is close by still does not fit what the passenger asked for.
export function explainMiss(
  request: PassengerRequest,
  pool: OwnerPoolCandidate,
  reason: RejectReason | 'ROUTING_ERROR',
  gaps: { startGapKm: number; endGapKm: number },
): string[] {
  switch (reason) {
    case 'PICKUP_TOO_FAR':
      return [
        gaps.startGapKm > request.maxPickupTravelKm
          ? `Its route passes about ${gaps.startGapKm} km from your start, but you only want to travel ${request.maxPickupTravelKm} km to be picked up.`
          : `Reaching its route from your start is further by road than the ${request.maxPickupTravelKm} km you want to travel.`,
      ];
    case 'DROPOFF_TOO_FAR':
      return [
        request.maxDropoffTravelKm !== undefined
          ? `It drops off about ${Math.max(gaps.endGapKm, request.maxDropoffTravelKm)} km or more from your destination, beyond the ${request.maxDropoffTravelKm} km you accept.`
          : 'Its route ends too far from your destination.',
      ];
    case 'ROUTE_ORDER':
      return ['It would pass your destination before your start, so it is heading the other way.'];
    case 'DETOUR':
      return [`The driver would have to go too far out of their way (their limit is ${pool.maxDriverDetourKm} km extra).`];
    case 'SEATS':
      return [`Only ${pool.availableSeats} seat${pool.availableSeats === 1 ? '' : 's'} free, and you need ${request.people}.`];
    case 'LUGGAGE':
      return ['There is not enough room for your luggage.'];
    case 'TIME': {
      const minutes = Math.round((pool.arriveBy.getTime() - request.arriveBy.getTime()) / 60_000);
      return [
        `It reaches its destination about ${Math.abs(minutes)} min ${minutes > 0 ? 'after' : 'before'} the time you need to arrive.`,
      ];
    }
    case 'BUDGET':
      return [`Its fixed fare (₹${pool.askingPrice}) is above your budget (₹${request.maxBudget}).`];
    case 'ROUTING_ERROR':
      return ["We couldn't check this pool just now."];
    default:
      return [];
  }
}

export function toNearbyPool(
  request: PassengerRequest,
  pool: OwnerPoolCandidate,
  reason: RejectReason | 'ROUTING_ERROR',
): NearbyPool {
  const gaps = gapsToRoute(request, pool);
  return {
    poolId: pool.id,
    route: { from: pool.originLabel, to: pool.destinationLabel },
    vehicle: pool.vehicle,
    seatsAvailable: pool.availableSeats,
    fare: { amount: pool.askingPrice, negotiable: pool.negotiable },
    arriveBy: pool.arriveBy.toISOString(),
    ...gaps,
    why: explainMiss(request, pool, reason, gaps),
  };
}
