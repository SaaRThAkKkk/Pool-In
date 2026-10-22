import { z } from 'zod';
import { AppError } from '../../utils/errors.js';
import type { LatLng } from '../../utils/geo.js';
import { logger } from '../../utils/logger.js';
import type { MapsProvider, Place, RouteResult } from './types.js';

// India's bounding box as minLon,minLat,maxLon,maxLat. Neighbouring countries inside it are filtered out below.
const INDIA_BBOX = '68.1,6.7,97.4,35.7';
const MAX_RESULTS = 8;
const REQUEST_TIMEOUT_MS = 6000;

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
      const f = photonFeature.safeParse(raw);
      if (!f.success) continue;
      const { properties: p, geometry } = f.data;
      if (p.countrycode && p.countrycode.toUpperCase() !== 'IN') continue;

      const text = describe(p);
      if (!text) continue;
      const label = text.subtitle ? `${text.title}, ${text.subtitle}` : text.title;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const [lng, lat] = geometry.coordinates;
      places.push({
        id: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : `${lat.toFixed(5)},${lng.toFixed(5)}`,
        ...text,
        label,
        lat,
        lng,
      });
      if (places.length >= MAX_RESULTS) break;
    }
    return places;
  }

  async getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${this.cfg.osrmUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`;

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
}
