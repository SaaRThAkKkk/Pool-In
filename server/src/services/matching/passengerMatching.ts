import { MATCHING } from '../../config/matching.js';
import { AppError } from '../../utils/errors.js';
import { distanceMetres, type LatLng } from '../../utils/geo.js';
import type { MapsProvider } from '../maps/types.js';
import { combineScores, routeScore, walkScore } from './scoring.js';
import type { PassengerEvaluation, PassengerRejectReason, PassengerRequest, PeerRequest } from './types.js';

class RoutingFailure extends Error {}

const MIN = 60_000;
const km = (m: number) => m / 1000;
const round1 = (n: number) => Number(n.toFixed(1));

async function roadMeters(maps: MapsProvider, a: LatLng, b: LatLng): Promise<number> {
  if (distanceMetres(a, b) < 1) return 0;
  try {
    return (await maps.getRoute(a, b)).distanceMeters;
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_ROUTE') return Infinity;
    throw new RoutingFailure();
  }
}

const midpoint = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

interface Meeting {
  point: LatLng;
  roadMeters: [number, number];
}

// The best single place both passengers can reach: each must be within their own limit by real road distance,
// and the pair that travels least wins. Tries each passenger's own spot and the point halfway between.
async function bestMeeting(
  maps: MapsProvider,
  mine: LatLng,
  theirs: LatLng,
  myLimitM: number,
  theirLimitM: number,
  direction: 'to' | 'from',
): Promise<Meeting | null> {
  let best: Meeting | null = null;
  for (const point of [mine, theirs, midpoint(mine, theirs)]) {
    // Straight line is a lower bound on the road distance, so it can rule a point out without any routing.
    if (distanceMetres(mine, point) > myLimitM || distanceMetres(theirs, point) > theirLimitM) continue;

    const leg = (from: LatLng) => (direction === 'to' ? roadMeters(maps, from, point) : roadMeters(maps, point, from));
    const a = await leg(mine);
    const b = await leg(theirs);
    if (a > myLimitM || b > theirLimitM) continue;
    if (!best || a + b < best.roadMeters[0] + best.roadMeters[1]) best = { point, roadMeters: [a, b] };
  }
  return best;
}

/**
 * Decides whether two passengers could share a cab. This produces a PROPOSED GROUP, not a ride: there is no
 * driver or vehicle, and nothing is booked or confirmed until every passenger has accepted.
 */
export async function evaluatePassengerPair(
  me: PassengerRequest,
  other: PeerRequest,
  { maps, now = new Date() }: { maps: MapsProvider; now?: Date },
): Promise<PassengerEvaluation> {
  const reject = (reason: PassengerRejectReason): PassengerEvaluation => ({ ok: false, reason });

  // --- Hard rules that need no routing ---------------------------------------------------------------------
  if (me.userId === other.userId) return reject('UNAVAILABLE');

  const groupSize = me.people + other.people;
  if (groupSize > MATCHING.CAB.MAX_PEOPLE) return reject('CAPACITY');
  if (me.luggageUnits + other.luggageUnits > MATCHING.CAB.LUGGAGE_UNITS) return reject('LUGGAGE');

  const gapMinutes = Math.abs(me.arriveBy.getTime() - other.arriveBy.getTime()) / MIN;
  if (gapMinutes > MATCHING.CAB.TIME_WINDOW_MIN) return reject('TIME');

  if (km(distanceMetres(me.destination, other.destination)) > MATCHING.CAB.MAX_DESTINATION_SEPARATION_KM) {
    return reject('ROUTES_DIFFER');
  }

  const myPickupM = me.maxPickupTravelKm * 1000;
  const theirPickupM = other.maxPickupTravelKm * 1000;
  if (distanceMetres(me.origin, other.origin) > myPickupM + theirPickupM) return reject('PICKUP_TOO_FAR');

  const myDropM = me.maxDropoffTravelKm === undefined ? Infinity : me.maxDropoffTravelKm * 1000;
  const theirDropM = other.maxDropoffTravelKm === undefined ? Infinity : other.maxDropoffTravelKm * 1000;

  try {
    // --- A shared pickup and drop-off, each within both passengers' limits by real road distance ------------
    const pickup = await bestMeeting(maps, me.origin, other.origin, myPickupM, theirPickupM, 'to');
    if (!pickup) return reject('PICKUP_TOO_FAR');

    const dropoff = await bestMeeting(maps, me.destination, other.destination, myDropM, theirDropM, 'from');
    if (!dropoff) return reject('DROPOFF_TOO_FAR');

    // --- The shared leg: one cab from the common pickup to the common drop-off -----------------------------
    const ride = await maps.getRoute(pickup.point, dropoff.point);
    if (ride.distanceMeters < MATCHING.CAB.MIN_RIDE_METRES) return reject('TOO_SHORT');

    // --- Everything passed. Now score it. -----------------------------------------------------------------
    const rideKm = km(ride.distanceMeters);
    const [myPickupKm, theirPickupKm] = pickup.roadMeters.map(km) as [number, number];
    const [myDropKm, theirDropKm] = dropoff.roadMeters.map(km) as [number, number];
    const bothSetDropLimit = me.maxDropoffTravelKm !== undefined && other.maxDropoffTravelKm !== undefined;

    const { score, breakdown } = combineScores({
      route: (routeScore(rideKm, myPickupKm, myDropKm) + routeScore(rideKm, theirPickupKm, theirDropKm)) / 2,
      pickup: (walkScore(myPickupKm, me.maxPickupTravelKm) + walkScore(theirPickupKm, other.maxPickupTravelKm)) / 2,
      time: 1 - gapMinutes / MATCHING.CAB.TIME_WINDOW_MIN,
      // No driver detour for a shared cab, and no reliable fare yet, so those components do not apply.
      ...(bothSetDropLimit
        ? { dropoff: (walkScore(myDropKm, me.maxDropoffTravelKm!) + walkScore(theirDropKm, other.maxDropoffTravelKm!)) / 2 }
        : {}),
    });

    return {
      ok: true,
      match: {
        section: 'CAB',
        requestId: other.id,
        score,
        breakdown,
        reasons: [
          `Both of you can reach the shared pickup: it is ${round1(myPickupKm)} km from you by road, within your ${me.maxPickupTravelKm} km limit.`,
          `The shared drop-off is ${round1(myDropKm)} km from your destination.`,
          `Your arrival times are ${Math.round(gapMinutes)} min apart, within the ${MATCHING.CAB.TIME_WINDOW_MIN} min window.`,
          `A group of ${groupSize} fits in one cab, with room for everyone's luggage.`,
          'The fare split cannot be estimated reliably yet, so it will be agreed between you.',
        ],
        otherPeople: other.people,
        groupSize,
        pickup: { lat: pickup.point.lat, lng: pickup.point.lng, roadKmForYou: round1(myPickupKm) },
        dropoff: { lat: dropoff.point.lat, lng: dropoff.point.lng, roadKmForYou: round1(myDropKm) },
        rideKm: round1(rideKm),
        rideMinutes: Math.max(1, Math.round(ride.durationSeconds / 60)),
        note: 'A proposed group, not a confirmed ride. There is no driver or vehicle yet, and nothing is booked until everyone accepts.',
        evaluatedAt: now.toISOString(),
      },
    };
  } catch (err) {
    // Routing could not be completed: say so, never guess.
    if (err instanceof RoutingFailure) return { ok: false, reason: 'ROUTING_ERROR' };
    if (err instanceof AppError && err.code === 'NO_ROUTE') return reject('ROUTES_DIFFER');
    return { ok: false, reason: 'ROUTING_ERROR' };
  }
}
