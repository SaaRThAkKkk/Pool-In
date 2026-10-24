import { z } from 'zod';
import { AppError } from '../../utils/errors.js';
import type { LatLng } from '../../utils/geo.js';
import { logger } from '../../utils/logger.js';
import type { ItineraryResult, MapsProvider, Place, RouteOptions, RouteResult } from './types.js';

// India's bounding box as minLon,minLat,maxLon,maxLat. Neighbouring countries inside it are filtered out below.
const INDIA_BBOX = '68.1,6.7,97.4,35.7';
const MAX_RESULTS = 8;
const REQUEST_TIMEOUT_MS = 6000;
const REVERSE_RADIUS_KM = 1;

export interface OsmProviderConfig {
  photonUrl: string;
  osrmUrl: string;
  userAgent: string;
  fetchFn?: typeof fetch;
}

const unavailable = () =>
  new AppError(502, 'MAPS_UNAVAILABLE', 'Place search is temporarily unavailable. Please try again shortly.');

// What we rely on from Photon. Anything else is ignored, and malformed entries are skipped.
const photonFeature = z.object({
  properties: z.object({
    osm_type: z.string().optional(),
    osm_id: z.number().optional(),
    name: z.string().optional(),
    housenumber: z.string().optional(),
    street: z.string().optional(),
    locality: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    countrycode: z.string().optional(),
  }),
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }), // [lng, lat]
});
const photonResponse = z.object({ features: z.array(z.unknown()) });

const osrmResponse = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }), // [lng, lat]
      }),
    )
    .optional(),
});

const osrmItinerary = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        legs: z.array(z.object({ distance: z.number(), duration: z.number() })),
      }),
    )
    .optional(),
});

const unique = (parts: (string | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p?.trim())).filter((p, i, all) => all.indexOf(p) === i);

type PhotonProps = z.infer<typeof photonFeature>['properties'];

function describe(p: PhotonProps): { title: string; subtitle: string } | null {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ') || undefined;
  const title = p.name ?? street;
  if (!title) return null;
  const context = unique([
    p.name ? street : undefined,
    p.locality ?? p.district,
    p.city ?? p.county,
    p.state,
  ]).filter((c) => c !== title);
  return { title, subtitle: context.slice(0, 3).join(', ') };
}

// One Photon feature as a Place, or null when it is malformed, outside India or has no usable name.
function toPlace(raw: unknown): Place | null {
  const f = photonFeature.safeParse(raw);
  if (!f.success) return null;
  const { properties: p, geometry } = f.data;
  if (p.countrycode && p.countrycode.toUpperCase() !== 'IN') return null;

  const text = describe(p);
  if (!text) return null;
  const [lng, lat] = geometry.coordinates;
  return {
    id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : `${lat.toFixed(5)},${lng.toFixed(5)}`,
    ...text,
    label: text.subtitle ? `${text.title}, ${text.subtitle}` : text.title,
    lat,
    lng,
  };
}

export class OpenStreetMapProvider implements MapsProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly cfg: OsmProviderConfig) {
    this.fetchFn = cfg.fetchFn ?? fetch;
  }

  private async getJson(url: string): Promise<unknown> {
    try {
      const res = await this.fetchFn(url, {
        headers: { 'User-Agent': this.cfg.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, host: new URL(url).host }, 'maps upstream returned an error status');
        // 4xx from OSRM carries a meaningful body (e.g. NoRoute), so let callers inspect it.
        if (res.status >= 500 || res.status === 429) throw unavailable();
      }
      return await res.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err }, 'maps upstream request failed');
      throw unavailable();
    }
  }

  async searchPlaces(query: string, bias?: LatLng): Promise<Place[]> {
    const url = new URL('/api/', this.cfg.photonUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(MAX_RESULTS + 4)); // a few spare for filtering and de-duplication
    url.searchParams.set('lang', 'en');
    url.searchParams.set('bbox', INDIA_BBOX);
    if (bias) {
      url.searchParams.set('lat', String(bias.lat));
      url.searchParams.set('lon', String(bias.lng));
    }

    const parsed = photonResponse.safeParse(await this.getJson(url.toString()));
    if (!parsed.success) {
      logger.warn('maps: unexpected geocoder response shape');
      throw unavailable();
    }

    const seen = new Set<string>();
    const places: Place[] = [];
    for (const raw of parsed.data.features) {
      const place = toPlace(raw);
      if (!place) continue;
      const key = place.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(place);
      if (places.length >= MAX_RESULTS) break;
    }
    return places;
  }

  // The place under a point picked on the map. Photon names the nearest feature (within a short radius);
  // when nothing is named there, the point itself is returned so the user can still choose it.
  async reversePlace(point: LatLng): Promise<Place> {
    const url = new URL('/reverse', this.cfg.photonUrl);
    url.searchParams.set('lat', String(point.lat));
    url.searchParams.set('lon', String(point.lng));
    url.searchParams.set('limit', '1');
    url.searchParams.set('radius', String(REVERSE_RADIUS_KM));
    url.searchParams.set('lang', 'en');

    const parsed = photonResponse.safeParse(await this.getJson(url.toString()));
    if (!parsed.success) {
      logger.warn('maps: unexpected reverse geocoder response shape');
      throw unavailable();
    }
    const named = parsed.data.features.map(toPlace).find((p): p is Place => p !== null);
    // The pin itself is what the user chose, so keep its exact position and only borrow the name.
    return named
      ? { ...named, lat: point.lat, lng: point.lng, id: `pin:${named.id}` }
      : {
          id: `pin:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`,
          title: 'Pinned location',
          subtitle: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
          label: `Pinned location (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})`,
          lat: point.lat,
          lng: point.lng,
        };
  }

  async getRoute(from: LatLng, to: LatLng, options: RouteOptions = {}): Promise<RouteResult> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const overview = options.detail === 'full' ? 'full' : 'simplified';
    const url = `${this.cfg.osrmUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=${overview}&geometries=geojson`;

    const parsed = osrmResponse.safeParse(await this.getJson(url));
    if (!parsed.success) {
      logger.warn('maps: unexpected routing response shape');
      throw unavailable();
    }
    const body = parsed.data;
    if (body.code === 'NoRoute') {
      throw new AppError(422, 'NO_ROUTE', 'No driving route was found between these two places.');
    }
    const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
    if (!route) throw unavailable();

    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    };
  }

  async getItinerary(points: LatLng[]): Promise<ItineraryResult> {
    if (points.length < 2) throw new Error('an itinerary needs at least two points');
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.cfg.osrmUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=false&steps=false`;

    const parsed = osrmItinerary.safeParse(await this.getJson(url));
    if (!parsed.success) {
      logger.warn('maps: unexpected itinerary response shape');
      throw unavailable();
    }
    if (parsed.data.code === 'NoRoute') {
      throw new AppError(422, 'NO_ROUTE', 'No driving route was found between these places.');
    }
    const route = parsed.data.code === 'Ok' ? parsed.data.routes?.[0] : undefined;
    // One leg per hop. Anything else means the answer cannot be trusted.
    if (!route || route.legs.length !== points.length - 1) throw unavailable();

    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      legs: route.legs.map((l) => ({ distanceMeters: l.distance, durationSeconds: l.duration })),
    };
  }
}
