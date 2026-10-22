import { TtlCache } from '../../utils/ttlCache.js';
import type { LatLng } from '../../utils/geo.js';
import type { MapsProvider, Place, RouteResult } from './types.js';

// Wraps a provider with short-lived caches so repeated searches do not hammer free public services
// (they have strict fair-use limits). Failures are never cached.
export class CachedMapsProvider implements MapsProvider {
  private readonly searches: TtlCache<Place[]>;
  private readonly routes: TtlCache<RouteResult>;

  constructor(
    private readonly inner: MapsProvider,
    now: () => number = Date.now,
  ) {
    this.searches = new TtlCache(10 * 60_000, 500, now);
    this.routes = new TtlCache(30 * 60_000, 200, now);
  }

  searchPlaces(query: string, bias?: LatLng): Promise<Place[]> {
    // Bias is rounded to about 10 km so nearby users share cache entries.
    const key = `${query.trim().toLowerCase()}|${bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : ''}`;
    return this.cached(this.searches, key, () => this.inner.searchPlaces(query, bias));
  }

  getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
    const p = (n: number) => n.toFixed(4); // about 11 m
    const key = `${p(from.lat)},${p(from.lng)}>${p(to.lat)},${p(to.lng)}`;
    return this.cached(this.routes, key, () => this.inner.getRoute(from, to));
  }

  private async cached<V>(cache: TtlCache<V>, key: string, load: () => Promise<V>): Promise<V> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    cache.set(key, value);
    return value;
  }
}
