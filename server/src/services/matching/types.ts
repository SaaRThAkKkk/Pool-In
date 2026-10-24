import type { PoolSection } from '../../config/pools.js';
import type { ScoreComponent } from './scoring.js';
import type { LatLng, LatLngTuple } from '../../utils/geo.js';

// A passenger's request, in the shape the matching code needs. Built from a cab request.
export interface PassengerRequest {
  /** The saved cab request, when there is one (it is left out of its own passenger matching). */
  id?: string;
  userId: string;
  origin: LatLng;
  destination: LatLng;
  /** The time the passenger needs to reach their destination. */
  arriveBy: Date;
  people: number;
  luggageUnits: number;
  /** Most the passenger will travel by road from where they are to the agreed pickup point. */
  maxPickupTravelKm: number;
  /** Optional: most the passenger will travel by road from the drop-off point to their destination. */
  maxDropoffTravelKm?: number;
  /** Optional: most they want to pay per person. */
  maxBudget?: number;
}

export interface ConfirmedStop {
  seats: number;
  pickup: LatLng;
  dropoff: LatLng;
}

// A car-owner pool, in the shape the matching code needs.
export interface OwnerPoolCandidate {
  id: string;
  userId: string;
  originLabel: string;
  destinationLabel: string;
  origin: LatLng;
  destination: LatLng;
  /** The time the owner reaches their destination. */
  arriveBy: Date;
  availableSeats: number;
  luggageUnitsAvailable: number;
  askingPrice: number;
  negotiable: boolean;
  /** Most extra distance the owner will drive. */
  maxDriverDetourKm: number;
  vehicle: { category: string; make: string; model: string };
  route: { distanceMeters: number; durationSeconds: number; line: LatLngTuple[] };
  /** Riders already confirmed, whose stops must stay in the itinerary. */
  confirmedStops: ConfirmedStop[];
}

export type RejectReason =
  | 'UNAVAILABLE' // not open, already departed, or the owner's own request
  | 'SEATS'
  | 'LUGGAGE'
  | 'TIME'
  | 'BUDGET'
  | 'NO_ROUTE_DATA'
  | 'PICKUP_TOO_FAR'
  | 'DROPOFF_TOO_FAR'
  | 'ROUTE_ORDER'
  | 'DETOUR';

export interface OwnerMatch {
  section: 'CAR_OWNER';
  poolId: string;
  /** 0 to 100. */
  score: number;
  breakdown: ScoreComponent[];
  /** Plain-language reasons this is a good match. */
  reasons: string[];
  route: { from: string; to: string };
  vehicle: { category: string; make: string; model: string };
  seatsAvailable: number;
  fare: { amount: number; negotiable: boolean };
  pickup: { lat: number; lng: number; roadKmFromRequestedPickup: number; eta: string };
  dropoff: { lat: number; lng: number; roadKmToDestination: number; eta: string };
  /** Extra distance the driver drives, by road, for this passenger. */
  driverDetourKm: number;
  /** How far the passenger rides with the driver. */
  rideKm: number;
  /** When the driver would set off, working back from their arrival time. */
  driverDepartsAt: string;
  evaluatedAt: string;
}

// A pool that is close to the passenger but does NOT fit what they asked for. Shown when nothing fits, so they can
// see what exists and why it was not matched. Never presented as a match.
export interface NearbyPool {
  poolId: string;
  route: { from: string; to: string };
  vehicle: { category: string; make: string; model: string };
  seatsAvailable: number;
  fare: { amount: number; negotiable: boolean };
  /** When the owner reaches their destination. */
  arriveBy: string;
  /** Straight-line distance from the passenger's start / destination to the pool's route. */
  startGapKm: number;
  endGapKm: number;
  /** Why it does not fit. */
  why: string[];
}

export type OwnerEvaluation =
  | { ok: true; match: OwnerMatch }
  | { ok: false; reason: RejectReason }
  /** The routing service failed, so this candidate could not be checked. It is never reported as a match. */
  | { ok: false; reason: 'ROUTING_ERROR' };

export interface OwnerSearchResult {
  /**
   * OK: every candidate was checked. DEGRADED: routing failed for some, so the list may be incomplete.
   * NEEDS_COORDINATES: the request has no coordinates, so no search was possible.
   */
  status: 'OK' | 'DEGRADED' | 'NEEDS_COORDINATES';
  /** Both sections a search covers; the owner search itself looks only at car-owner pools. */
  sections: readonly PoolSection[];
  matches: OwnerMatch[];
  /** How many candidates were checked with real routing, and how many could not be. */
  checked: number;
  routingFailures: number;
  rejected: Partial<Record<RejectReason, number>>;
}

// A proposed group of passengers sharing a cab. It is NOT a confirmed ride: there is no driver or vehicle yet.
export interface PassengerMatch {
  section: 'CAB';
  requestId: string;
  score: number;
  breakdown: ScoreComponent[];
  reasons: string[];
  /** The other traveller's party size. Their identity is never shown before both sides agree. */
  otherPeople: number;
  groupSize: number;
  pickup: { lat: number; lng: number; roadKmForYou: number };
  dropoff: { lat: number; lng: number; roadKmForYou: number };
  rideKm: number;
  rideMinutes: number;
  note: string;
  evaluatedAt: string;
}

export type PassengerEvaluation =
  | { ok: true; match: PassengerMatch }
  | { ok: false; reason: PassengerRejectReason }
  | { ok: false; reason: 'ROUTING_ERROR' };

export type PassengerRejectReason =
  | 'UNAVAILABLE'
  | 'TIME'
  | 'CAPACITY'
  | 'LUGGAGE'
  | 'ROUTES_DIFFER'
  | 'PICKUP_TOO_FAR'
  | 'DROPOFF_TOO_FAR'
  | 'TOO_SHORT';

export interface PassengerSearchResult {
  status: 'OK' | 'DEGRADED' | 'NEEDS_COORDINATES';
  matches: PassengerMatch[];
  checked: number;
  routingFailures: number;
  rejected: Partial<Record<PassengerRejectReason, number>>;
}

// The peer request used when comparing two passengers.
export interface PeerRequest extends PassengerRequest {
  id: string;
}
