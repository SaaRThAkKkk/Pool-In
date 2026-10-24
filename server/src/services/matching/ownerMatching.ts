import { MATCHING } from '../../config/matching.js';
import {
  distanceMetres,
  nearestVertices,
  polylineLengths,
  projectOntoPolyline,
  type LatLng,
  type LatLngTuple,
} from '../../utils/geo.js';
import { AppError } from '../../utils/errors.js';
import type { MapsProvider } from '../maps/types.js';
import { budgetScore, combineScores, detourScore, routeScore, timeScore, walkScore } from './scoring.js';
import type { OwnerEvaluation, OwnerPoolCandidate, PassengerRequest, RejectReason } from './types.js';

export interface EvaluateDeps {
  maps: MapsProvider;
  now?: Date;
}

// The routing service itself failed (not "there is no road"). The candidate cannot be checked, so it must
// never be reported as a match.
class RoutingFailure extends Error {}

const MIN = 60_000;
const km = (meters: number) => meters / 1000;
const round1 = (n: number) => Number(n.toFixed(1));

// Real road distance in metres between two points, or Infinity when there is simply no road between them.
async function roadMeters(maps: MapsProvider, a: LatLng, b: LatLng): Promise<number> {
  try {
    return (await maps.getRoute(a, b)).distanceMeters;
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_ROUTE') return Infinity;
    throw new RoutingFailure();
  }
}

interface RoutePoint {
  point: LatLng;
  /** How far along the owner's route this point is. */
  progress: number;
}

// A few places on the owner's route that are near `target`: the closest point on the road, plus nearby
// vertices of the route. Only those within `maxMeters` in a straight line can possibly be within it by road.
function candidatePoints(line: LatLngTuple[], lengths: number[], target: LatLng, maxMeters: number): RoutePoint[] {
  const proj = projectOntoPolyline(line, target, lengths);
  if (!proj || proj.distanceMeters > maxMeters) return [];

  const picked: RoutePoint[] = [{ point: proj.point, progress: proj.progressMeters }];
  for (const v of nearestVertices(line, target, MATCHING.POINTS_PER_END + 2)) {
    if (picked.length >= MATCHING.POINTS_PER_END) break;
    if (v.distanceMeters > maxMeters) continue;
    const point = { lat: line[v.index]![0], lng: line[v.index]![1] };
    if (picked.some((p) => distanceMetres(p.point, point) < 150)) continue; // not a meaningfully different place
    picked.push({ point, progress: lengths[v.index]! });
  }
  return picked;
}

// The candidate whose real road distance to `target` is shortest, if any is within `limitMeters`.
async function bestByRoad(
  maps: MapsProvider,
  options: RoutePoint[],
  target: LatLng,
  limitMeters: number,
  towardTarget: boolean,
): Promise<{ choice: RoutePoint; roadMeters: number } | null> {
  let best: { choice: RoutePoint; roadMeters: number } | null = null;
  for (const option of options) {
    const d = towardTarget ? await roadMeters(maps, option.point, target) : await roadMeters(maps, target, option.point);
    if (d <= limitMeters && (!best || d < best.roadMeters)) best = { choice: option, roadMeters: d };
  }
  return best;
}

/**
 * Decides whether one passenger request fits one car-owner pool, and if so how well.
 *
 * Every hard rule is checked before anything is scored, and a failed rule rejects the candidate outright: a high
 * score can never make up for it. The cheap checks (seats, luggage, time, straight-line distance) run first so
 * that routing is only used for candidates that could still work.
 */
export async function evaluateOwnerCandidate(
  request: PassengerRequest,
  pool: OwnerPoolCandidate,
  { maps, now = new Date() }: EvaluateDeps,
): Promise<OwnerEvaluation> {
  const reject = (reason: RejectReason): OwnerEvaluation => ({ ok: false, reason });

  // --- Hard rules that need no routing ---------------------------------------------------------------------
  if (pool.userId === request.userId) return reject('UNAVAILABLE'); // never match someone with their own pool
  if (pool.route.line.length < 2) return reject('NO_ROUTE_DATA');

  // Not departed: the owner has to be able to set off, working back from their arrival time.
  const ownerDeparture = pool.arriveBy.getTime() - pool.route.durationSeconds * 1000;
  if (ownerDeparture < now.getTime()) return reject('UNAVAILABLE');

  if (pool.availableSeats < request.people) return reject('SEATS');
  if (pool.luggageUnitsAvailable < request.luggageUnits) return reject('LUGGAGE');

  // The passenger is dropped off before the owner reaches their destination, so the owner cannot arrive earlier
  // than the passenger's earliest acceptable drop-off, and not later than the deadline plus the whole drive.
  const earliest = request.arriveBy.getTime() - MATCHING.MAX_EARLY_ARRIVAL_MIN * MIN;
  const latest = request.arriveBy.getTime() + pool.route.durationSeconds * 1000;
  if (pool.arriveBy.getTime() < earliest || pool.arriveBy.getTime() > latest) return reject('TIME');

  // A fixed fare above the passenger's budget is a reliable reason to reject. A negotiable one is not.
  if (request.maxBudget !== undefined && !pool.negotiable && pool.askingPrice > request.maxBudget) return reject('BUDGET');

  // --- Where the route passes the passenger -----------------------------------------------------------------
  const line = pool.route.line;
  const lengths = polylineLengths(line);
  const maxPickupM = request.maxPickupTravelKm * 1000;
  const maxDropoffM = request.maxDropoffTravelKm === undefined ? Infinity : request.maxDropoffTravelKm * 1000;

  const pickupOptions = candidatePoints(line, lengths, request.origin, maxPickupM);
  if (pickupOptions.length === 0) return reject('PICKUP_TOO_FAR'); // straight-line distance already exceeds the limit

  // With no drop-off limit set, the closest point on the route to the destination is used, however far it is.
  const dropoffOptions = candidatePoints(line, lengths, request.destination, maxDropoffM);
  if (dropoffOptions.length === 0) return reject('DROPOFF_TOO_FAR');

  try {
    // --- Passenger pickup tolerance (real road distance) --------------------------------------------------
    const pickup = await bestByRoad(maps, pickupOptions, request.origin, maxPickupM, false);
    if (!pickup) return reject('PICKUP_TOO_FAR');

    // --- Drop-off: must come after the pickup along the driver's route ------------------------------------
    const afterPickup = dropoffOptions.filter((o) => o.progress - pickup.choice.progress >= MATCHING.MIN_RIDE_METRES);
    if (afterPickup.length === 0) return reject('ROUTE_ORDER');

    const dropoff = await bestByRoad(maps, afterPickup, request.destination, maxDropoffM, true);
    if (!dropoff) return reject('DROPOFF_TOO_FAR');

    // --- The driver's real extra distance, over the whole revised itinerary -------------------------------
    const known = pool.confirmedStops
      .flatMap((s, i) => [
        { point: s.pickup, key: `pick${i}` },
        { point: s.dropoff, key: `drop${i}` },
      ])
      .map((s) => ({ ...s, progress: projectOntoPolyline(line, s.point, lengths)?.progressMeters ?? 0 }))
      .sort((a, b) => a.progress - b.progress);

    const stops = [...known, { point: pickup.choice.point, key: 'P', progress: pickup.choice.progress }, { point: dropoff.choice.point, key: 'Q', progress: dropoff.choice.progress }].sort(
      (a, b) => a.progress - b.progress,
    );
    const points = [pool.origin, ...stops.map((s) => s.point), pool.destination];
    const iP = 1 + stops.findIndex((s) => s.key === 'P');
    const iQ = 1 + stops.findIndex((s) => s.key === 'Q');

    // D_original: the owner's itinerary as it stands (with riders already confirmed, if any).
    const originalMeters =
      known.length === 0
        ? pool.route.distanceMeters
        : (await maps.getItinerary([pool.origin, ...known.map((s) => s.point), pool.destination])).distanceMeters;
    // D_new: the whole revised itinerary, measured by road. Never a sum of straight lines.
    const revised = await maps.getItinerary(points);

    const driverDetourKm = km(Math.max(0, revised.distanceMeters - originalMeters - MATCHING.DETOUR_NOISE_METRES));
    if (driverDetourKm > pool.maxDriverDetourKm) return reject('DETOUR');

    // --- Time: work back from when the owner arrives -------------------------------------------------------
    const remainingAfter = (index: number) => revised.legs.slice(index).reduce((sum, leg) => sum + leg.durationSeconds, 0);
    const arrive = pool.arriveBy.getTime();
    const etaDropoff = arrive - remainingAfter(iQ) * 1000;
    const etaPickup = arrive - remainingAfter(iP) * 1000;
    const earlyMinutes = (request.arriveBy.getTime() - etaDropoff) / MIN;
    if (earlyMinutes < 0 || earlyMinutes > MATCHING.MAX_EARLY_ARRIVAL_MIN) return reject('TIME');

    // --- Everything passed. Now, and only now, score it. ---------------------------------------------------
    const pickupKm = km(pickup.roadMeters);
    const dropoffKm = km(dropoff.roadMeters);
    const rideKm = km(dropoff.choice.progress - pickup.choice.progress);

    const { score, breakdown } = combineScores({
      route: routeScore(rideKm, pickupKm, dropoffKm),
      pickup: walkScore(pickupKm, request.maxPickupTravelKm),
      time: timeScore(earlyMinutes),
      detour: detourScore(driverDetourKm, pool.maxDriverDetourKm),
      ...(request.maxBudget !== undefined ? { budget: budgetScore(pool.askingPrice, request.maxBudget, pool.negotiable) } : {}),
      ...(request.maxDropoffTravelKm !== undefined ? { dropoff: walkScore(dropoffKm, request.maxDropoffTravelKm) } : {}),
    });

    const reasons = [
      `Pickup is ${round1(pickupKm)} km from you by road, within your ${request.maxPickupTravelKm} km limit.`,
      request.maxDropoffTravelKm !== undefined
        ? `Drop-off is ${round1(dropoffKm)} km from your destination, within your ${request.maxDropoffTravelKm} km limit.`
        : `Drop-off is ${round1(dropoffKm)} km from your destination.`,
      `The driver's extra distance is ${round1(driverDetourKm)} km, within their ${pool.maxDriverDetourKm} km limit.`,
      `You would arrive about ${Math.round(earlyMinutes)} min before your deadline.`,
      `${pool.availableSeats} seat${pool.availableSeats === 1 ? '' : 's'} free for your party of ${request.people}, with room for your luggage.`,
      ...(request.maxBudget !== undefined
        ? [
            pool.askingPrice <= request.maxBudget
              ? `Fare of ₹${pool.askingPrice} per person is within your budget.`
              : `Fare of ₹${pool.askingPrice} per person is above your budget, but the owner says it is negotiable.`,
          ]
        : []),
    ];

    return {
      ok: true,
      match: {
        section: 'CAR_OWNER',
        poolId: pool.id,
        score,
        breakdown,
        reasons,
        route: { from: pool.originLabel, to: pool.destinationLabel },
        vehicle: pool.vehicle,
        seatsAvailable: pool.availableSeats,
        fare: { amount: pool.askingPrice, negotiable: pool.negotiable },
        pickup: {
          lat: pickup.choice.point.lat,
          lng: pickup.choice.point.lng,
          roadKmFromRequestedPickup: round1(pickupKm),
          eta: new Date(etaPickup).toISOString(),
        },
        dropoff: {
          lat: dropoff.choice.point.lat,
          lng: dropoff.choice.point.lng,
          roadKmToDestination: round1(dropoffKm),
          eta: new Date(etaDropoff).toISOString(),
        },
        driverDetourKm: round1(driverDetourKm),
        rideKm: round1(rideKm),
        driverDepartsAt: new Date(arrive - revised.durationSeconds * 1000).toISOString(),
        evaluatedAt: now.toISOString(),
      },
    };
  } catch (err) {
    // Routing could not be completed: say so, never guess.
    if (err instanceof RoutingFailure) return { ok: false, reason: 'ROUTING_ERROR' };
    if (err instanceof AppError && err.code === 'NO_ROUTE') return reject('ROUTE_ORDER'); // no road for the whole itinerary
    return { ok: false, reason: 'ROUTING_ERROR' };
  }
}
