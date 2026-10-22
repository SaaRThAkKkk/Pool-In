import { describe, expect, it, vi } from 'vitest';
import { CachedMapsProvider } from '../src/services/maps/cachedMapsProvider.js';
import { OpenStreetMapProvider } from '../src/services/maps/openStreetMapProvider.js';
import { TtlCache } from '../src/utils/ttlCache.js';
import { AppError } from '../src/utils/errors.js';
import type { MapsProvider } from '../src/services/maps/types.js';

// Trimmed from a real response of photon.komoot.io (?q=indira&bbox=India), plus entries that exercise filtering.
const photonSample = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        osm_type: 'R', osm_id: 19597141, osm_key: 'aeroway', osm_value: 'aerodrome',
        name: 'Indira Gandhi International Airport', street: 'Abdul Gaffar Khan Marg',
        district: 'Najafgarh', county: 'South West Delhi', state: 'Delhi', country: 'India', countrycode: 'IN',
      },
      geometry: { type: 'Point', coordinates: [77.0848066, 28.5554221] },
    },
    {
      type: 'Feature',
      properties: { osm_type: 'W', osm_id: 263675056, name: 'Indira Gandhi National Open University', street: 'IGNOU Road', locality: 'Indira Enclave', district: 'South', county: 'South Delhi', state: 'Delhi', countrycode: 'IN' },
      geometry: { type: 'Point', coordinates: [77.2041056, 28.4956381] },
    },
    // Inside India's bounding box but in another country: must be dropped.
    {
      type: 'Feature',
      properties: { osm_type: 'N', osm_id: 1, name: 'Indira Chowk', city: 'Kathmandu', countrycode: 'NP' },
      geometry: { type: 'Point', coordinates: [85.3, 27.7] },
    },
    // Same label as the first entry: must be de-duplicated.
    {
      type: 'Feature',
      properties: { osm_type: 'N', osm_id: 2, name: 'Indira Gandhi International Airport', street: 'Abdul Gaffar Khan Marg', district: 'Najafgarh', county: 'South West Delhi', state: 'Delhi', countrycode: 'IN' },
      geometry: { type: 'Point', coordinates: [77.08, 28.55] },
    },
    // Malformed entries: skipped, not fatal.
    { type: 'Feature', properties: { name: 'No geometry' } },
    { type: 'Feature', properties: { osm_type: 'N', osm_id: 3, name: 'Bad coords', countrycode: 'IN' }, geometry: { coordinates: ['x', 'y'] } },
    // No name and no street: nothing sensible to show.
    { type: 'Feature', properties: { osm_type: 'N', osm_id: 4, state: 'Delhi', countrycode: 'IN' }, geometry: { coordinates: [77, 28] } },
  ],
};

const osrmSample = {
  code: 'Ok',
  routes: [{ distance: 35214.6, duration: 2140.4, geometry: { type: 'LineString', coordinates: [[77.640814, 12.978401], [77.7, 13.1], [77.7064, 13.1986]] } }],
  waypoints: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function provider(fetchFn: typeof fetch) {
  return new OpenStreetMapProvider({
    photonUrl: 'https://photon.example',
    osrmUrl: 'https://osrm.example/',
    userAgent: 'Pool-In-test/1.0',
    fetchFn,
  });
}

describe('OpenStreetMapProvider.searchPlaces', () => {
  it('maps results, swaps [lng,lat] to lat/lng, drops other countries, duplicates and malformed entries', async () => {
    const places = await provider(vi.fn(async () => json(photonSample))).searchPlaces('indira');

    expect(places.map((p) => p.label)).toEqual([
      'Indira Gandhi International Airport, Abdul Gaffar Khan Marg, Najafgarh, South West Delhi',
      'Indira Gandhi National Open University, IGNOU Road, Indira Enclave, South Delhi',
    ]);
    expect(places[0]).toMatchObject({
      id: 'R19597141',
      title: 'Indira Gandhi International Airport',
      subtitle: 'Abdul Gaffar Khan Marg, Najafgarh, South West Delhi',
      lat: 28.5554221,
      lng: 77.0848066,
    });
  });

  it('asks Photon for India only, near the user, with an identifying User-Agent', async () => {
    const fetchFn = vi.fn(async () => json({ features: [] }));
    await provider(fetchFn).searchPlaces('indira nagar', { lat: 12.97, lng: 77.59 });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin).toBe('https://photon.example');
    expect(u.pathname).toBe('/api/');
    expect(u.searchParams.get('q')).toBe('indira nagar');
    expect(u.searchParams.get('bbox')).toBe('68.1,6.7,97.4,35.7');
    expect(u.searchParams.get('lat')).toBe('12.97');
    expect(u.searchParams.get('lon')).toBe('77.59');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Pool-In-test/1.0');
  });

  it('caps the number of results', async () => {
    const many = {
      features: Array.from({ length: 20 }, (_, i) => ({
        properties: { osm_type: 'N', osm_id: i, name: `Place ${i}`, countrycode: 'IN' },
        geometry: { coordinates: [77 + i / 100, 12] },
      })),
    };
    expect(await provider(vi.fn(async () => json(many))).searchPlaces('place')).toHaveLength(8);
  });

  it('returns an empty list when nothing matches', async () => {
    expect(await provider(vi.fn(async () => json({ features: [] }))).searchPlaces('zzzz')).toEqual([]);
  });

  it.each([
    ['an upstream 500', () => json({}, 500)],
    ['an upstream 429', () => json({}, 429)],
    ['a response that is not the expected shape', () => json({ nope: true })],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
  ])('turns %s into a 502 MAPS_UNAVAILABLE', async (_label, respond) => {
    const err = await provider(vi.fn(async () => respond())).searchPlaces('indira').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 502, code: 'MAPS_UNAVAILABLE' });
  });

  it('turns a network failure or timeout into a 502 MAPS_UNAVAILABLE', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    await expect(provider(fetchFn).searchPlaces('indira')).rejects.toMatchObject({ status: 502, code: 'MAPS_UNAVAILABLE' });
  });
});

describe('OpenStreetMapProvider.getRoute', () => {
  const from = { lat: 12.9784, lng: 77.6408 };
  const to = { lat: 13.1986, lng: 77.7064 };

  it('requests lng,lat order and returns distance, time and a [lat,lng] path', async () => {
    const fetchFn = vi.fn(async () => json(osrmSample));
    const route = await provider(fetchFn).getRoute(from, to);

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toContain('/route/v1/driving/77.6408,12.9784;77.7064,13.1986');
    expect(url).toContain('geometries=geojson');
    expect(route.distanceMeters).toBe(35214.6);
    expect(route.durationSeconds).toBe(2140.4);
    expect(route.path[0]).toEqual([12.978401, 77.640814]);
    expect(route.path.at(-1)).toEqual([13.1986, 77.7064]);
  });

  it('reports "no route" as 422 NO_ROUTE', async () => {
    const err = await provider(vi.fn(async () => json({ code: 'NoRoute', message: 'x' }, 400))).getRoute(from, to).catch((e) => e);
    expect(err).toMatchObject({ status: 422, code: 'NO_ROUTE' });
  });

  it.each([
    ['an upstream 500', () => json({}, 500)],
    ['an unexpected code', () => json({ code: 'InvalidQuery' }, 400)],
    ['an OK answer without routes', () => json({ code: 'Ok', routes: [] })],
    ['a malformed body', () => json({ code: 'Ok', routes: [{ distance: 'far' }] })],
  ])('turns %s into a 502', async (_label, respond) => {
    await expect(provider(vi.fn(async () => respond())).getRoute(from, to)).rejects.toMatchObject({
      status: 502,
      code: 'MAPS_UNAVAILABLE',
    });
  });
});

describe('CachedMapsProvider', () => {
  function counting() {
    const inner: MapsProvider = {
      searchPlaces: vi.fn(async (q: string) => [{ id: q, title: q, subtitle: '', label: q, lat: 1, lng: 2 }]),
      getRoute: vi.fn(async () => ({ distanceMeters: 1, durationSeconds: 2, path: [[1, 2] as [number, number]] })),
    };
    return inner;
  }

  it('serves repeated searches from the cache, ignoring case and spacing', async () => {
    const inner = counting();
    const cached = new CachedMapsProvider(inner);
    await cached.searchPlaces('Indira');
    await cached.searchPlaces('  indira ');
    expect(inner.searchPlaces).toHaveBeenCalledTimes(1);
    await cached.searchPlaces('whitefield');
    expect(inner.searchPlaces).toHaveBeenCalledTimes(2);
  });

  it('shares cache entries between nearby users but not distant ones', async () => {
    const inner = counting();
    const cached = new CachedMapsProvider(inner);
    await cached.searchPlaces('mall', { lat: 12.971, lng: 77.594 });
    await cached.searchPlaces('mall', { lat: 12.9712, lng: 77.5941 });
    expect(inner.searchPlaces).toHaveBeenCalledTimes(1);
    await cached.searchPlaces('mall', { lat: 19.07, lng: 72.87 });
    expect(inner.searchPlaces).toHaveBeenCalledTimes(2);
  });

  it('caches routes by rounded endpoints', async () => {
    const inner = counting();
    const cached = new CachedMapsProvider(inner);
    await cached.getRoute({ lat: 12.97841, lng: 77.64081 }, { lat: 13.1986, lng: 77.7064 });
    await cached.getRoute({ lat: 12.97842, lng: 77.64082 }, { lat: 13.1986, lng: 77.7064 });
    expect(inner.getRoute).toHaveBeenCalledTimes(1);
  });

  it('expires entries after their lifetime', async () => {
    let now = 0;
    const inner = counting();
    const cached = new CachedMapsProvider(inner, () => now);
    await cached.searchPlaces('indira');
    now += 11 * 60_000;
    await cached.searchPlaces('indira');
    expect(inner.searchPlaces).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const inner = counting();
    vi.mocked(inner.searchPlaces).mockRejectedValueOnce(new AppError(502, 'MAPS_UNAVAILABLE', 'down'));
    const cached = new CachedMapsProvider(inner);
    await expect(cached.searchPlaces('indira')).rejects.toThrow();
    await expect(cached.searchPlaces('indira')).resolves.toHaveLength(1);
  });
});

describe('TtlCache', () => {
  it('evicts the oldest entries beyond its size cap', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });
});
