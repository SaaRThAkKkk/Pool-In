import { TtlCache } from '../../utils/ttlCache.js';
import type { LatLng } from '../../utils/geo.js';
import type { ItineraryResult, MapsProvider, Place, RouteOptions, RouteResult } from './types.js';

// Wraps a provider with short-lived caches so repeated searches do not hammer free public services
// (they have strict fair-use limits). Failures are never cached.
export class CachedMapsProvider implements MapsProvider {
  private readonly searches: TtlCache<Place[]>;
  private readonly reverses: TtlCache<Place>;
  private readonly routes: TtlCache<RouteResult>;
  private readonly itineraries: TtlCache<ItineraryResult>;

  constructor(
    private readonly inner: MapsProvider,
    now: () => number = Date.now,
  ) {
    this.searches = new TtlCache(10 * 60_000, 500, now);
    this.reverses = new TtlCache(30 * 60_000, 500, now);
    this.routes = new TtlCache(30 * 60_000, 200, now);
    // Matching asks about the same few hops again and again while a search is running.
    this.itineraries = new TtlCache(30 * 60_000, 2000, now);
  }

  searchPlaces(query: string, bias?: LatLng): Promise<Place[]> {
    // Bias is rounded to about 10 km so nearby users share cache entries.
    const key = `${query.trim().toLowerCase()}|${bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : ''}`;
    return this.cached(this.searches, key, () => this.inner.searchPlaces(query, bias));
  }

  reversePlace(p: LatLng): Promise<Place> {
    return this.cached(this.reverses, point(p), () => this.inner.reversePlace(p));
  }

  getRoute(from: LatLng, to: LatLng, options?: RouteOptions): Promise<RouteResult> {
    const key = `${options?.detail ?? 'simplified'}|${point(from)}>${point(to)}`;
    return this.cached(this.routes, key, () => this.inner.getRoute(from, to, options));
  }

  getItinerary(points: LatLng[]): Promise<ItineraryResult> {
    return this.cached(this.itineraries, points.map(point).join('>'), () => this.inner.getItinerary(points));
  }

  private async cached<V>(cache: TtlCache<V>, key: string, load: () => Promise<V>): Promise<V> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    cache.set(key, value);
    return value;
  }
}

const point = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`; // about 11 m
