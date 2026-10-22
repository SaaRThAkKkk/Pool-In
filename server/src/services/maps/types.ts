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
  /** Simplified path as [lat, lng] pairs, ready to draw. An estimate, not turn-by-turn directions. */
  path: [number, number][];
}

// The rest of the app depends only on this interface, so the OpenStreetMap-based provider can be
// replaced (Google, Mapbox, Ola Maps, ...) without touching routes or the client.
export interface MapsProvider {
  /** Places in India matching the typed text; `bias` ranks results near the user first. */
  searchPlaces(query: string, bias?: LatLng): Promise<Place[]>;
  getRoute(from: LatLng, to: LatLng): Promise<RouteResult>;
}
