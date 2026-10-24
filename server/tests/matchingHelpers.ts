import { AppError } from '../src/utils/errors.js';
import { distanceMetres, type LatLng, type LatLngTuple } from '../src/utils/geo.js';
import type { ItineraryResult, MapsProvider, Place, RouteResult } from '../src/services/maps/types.js';
import type { OwnerPoolCandidate, PassengerRequest } from '../src/services/matching/types.js';

// Indiranagar -> Kempegowda Airport, Bengaluru: about 24.6 km.
export const A: LatLng = { lat: 12.9784, lng: 77.6408 };
export const B: LatLng = { lat: 13.1986, lng: 77.7064 };

export const SPEED_MPS = 10; // the fake road network drives at 36 km/h

const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

export function straightLine(a: LatLng, b: LatLng, points = 40): LatLngTuple[] {
  return Array.from({ length: points }, (_, i) => {
    const p = lerp(a, b, i / (points - 1));
    return [p.lat, p.lng] as LatLngTuple;
  });
}

// A point `frac` of the way from a to b, moved `perpMeters` sideways (positive = left of travel).
export function pointNear(a: LatLng, b: LatLng, frac: number, perpMeters: number): LatLng {
  const base = lerp(a, b, frac);
  const cos = Math.cos((a.lat * Math.PI) / 180);
  const x = (b.lng - a.lng) * cos * 111_320;
  const y = (b.lat - a.lat) * 111_195;
  const len = Math.hypot(x, y);
  const px = -y / len;
  const py = x / len;
  return { lat: base.lat + (py * perpMeters) / 111_195, lng: base.lng + (px * perpMeters) / (111_320 * cos) };
}

// A road network where every road is a straight line (times `roadFactor` for point-to-point trips).
// Lets tests control exactly how far things are by road.
export class RoadMaps implements MapsProvider {
  /** Multiplies point-to-point road distances (a winding road is longer than the straight line). */
  roadFactor = 1;
  /** Added to every itinerary, to simulate a route that really does leave the planned road. */
  extraMeters = 0;
  /** Everything fails, like a routing outage. */
  failWith?: Error;
  /** Pairs with no road between them (matched on rounded coordinates). */
  noRoad: [LatLng, LatLng][] = [];

  routeCalls: [LatLng, LatLng][] = [];
  itineraryCalls: LatLng[][] = [];

  async searchPlaces(): Promise<Place[]> {
    return [];
  }

  async getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
    this.routeCalls.push([from, to]);
    if (this.failWith) throw this.failWith;
    const same = (p: LatLng, q: LatLng) => distanceMetres(p, q) < 5;
    if (this.noRoad.some(([x, y]) => (same(x, from) && same(y, to)) || (same(x, to) && same(y, from)))) {
      throw new AppError(422, 'NO_ROUTE', 'No driving route was found between these places.');
    }
    const d = distanceMetres(from, to) * this.roadFactor;
    return { distanceMeters: d, durationSeconds: d / SPEED_MPS, path: [[from.lat, from.lng], [to.lat, to.lng]] };
  }

  async getItinerary(points: LatLng[]): Promise<ItineraryResult> {
    this.itineraryCalls.push(points);
    if (this.failWith) throw this.failWith;
    const legs = points.slice(1).map((p, i) => {
      const d = distanceMetres(points[i]!, p);
      return { distanceMeters: d, durationSeconds: d / SPEED_MPS };
    });
    const distance = legs.reduce((s, l) => s + l.distanceMeters, 0) + this.extraMeters;
    return { distanceMeters: distance, durationSeconds: distance / SPEED_MPS, legs };
  }
}

export const HOUR = 3_600_000;
export const NOW = new Date('2030-06-01T06:00:00.000Z');

// An owner driving A -> B who reaches B three hours after NOW.
export function makePool(over: Partial<OwnerPoolCandidate> = {}): OwnerPoolCandidate {
  const origin = over.origin ?? A;
  const destination = over.destination ?? B;
  const distance = distanceMetres(origin, destination);
  return {
    id: 'pool-1',
    userId: 'owner-1',
    originLabel: 'Indiranagar',
    destinationLabel: 'Airport',
    origin,
    destination,
    arriveBy: new Date(NOW.getTime() + 3 * HOUR),
    availableSeats: 3,
    luggageUnitsAvailable: 6,
    askingPrice: 250,
    negotiable: false,
    maxDriverDetourKm: 5,
    vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
    route: { distanceMeters: distance, durationSeconds: distance / SPEED_MPS, line: straightLine(origin, destination) },
    confirmedStops: [],
    ...over,
  };
}

// A passenger whose trip lies along the owner's route: picked up 1 km off it, 20% of the way, dropped 0.5 km off it near the end.
export function makeRequest(over: Partial<PassengerRequest> = {}): PassengerRequest {
  const owner = makePool();
  return {
    userId: 'passenger-1',
    origin: pointNear(owner.origin, owner.destination, 0.2, 1000),
    destination: pointNear(owner.origin, owner.destination, 0.9, 500),
    // Deadline ten minutes after the owner reaches the airport: dropped near the end, so about 13 minutes early.
    arriveBy: new Date(owner.arriveBy.getTime() + 10 * 60_000),
    people: 1,
    luggageUnits: 1,
    maxPickupTravelKm: 2,
    maxDropoffTravelKm: 2,
    ...over,
  };
}
