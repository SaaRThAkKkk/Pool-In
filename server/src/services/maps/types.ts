import type { LatLng } from '../../utils/geo.js';

export interface Place {
  id: string;
  /** Short name shown in bold, e.g. the neighbourhood or landmark. */
  title: string;
  /** Wider context shown underneath, e.g. area, city, state. */
  subtitle: string;
  /** Full text stored on a ride (title plus context). */
  label: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** Path as [lat, lng] pairs, ready to draw. An estimate, not turn-by-turn directions. */
  path: [number, number][];
}

export interface RouteOptions {
  /** 'full' returns the road geometry at full resolution (needed to match passengers along a route). */
  detail?: 'simplified' | 'full';
}

export interface ItineraryLeg {
  distanceMeters: number;
  durationSeconds: number;
}

/** One drive through several waypoints, in the order given. `legs[i]` goes from point i to point i+1. */
export interface ItineraryResult {
  distanceMeters: number;
  durationSeconds: number;
  legs: ItineraryLeg[];
}

// The rest of the app depends only on this interface, so the OpenStreetMap-based provider can be
// replaced (Google, Mapbox, Ola Maps, ...) without touching routes or the client.
export interface MapsProvider {
  /** Places in India matching the typed text; `bias` ranks results near the user first. */
  searchPlaces(query: string, bias?: LatLng): Promise<Place[]>;
  getRoute(from: LatLng, to: LatLng, options?: RouteOptions): Promise<RouteResult>;
  /** Real road distance and time for a drive that visits every point in order. At least two points. */
  getItinerary(points: LatLng[]): Promise<ItineraryResult>;
}
