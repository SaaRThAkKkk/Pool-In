import { Router, type RequestHandler } from 'express';
import { makeLimiter } from '../middleware/rateLimit.js';
import { validateQuery } from '../middleware/validate.js';
import type { MapsProvider } from '../services/maps/types.js';
import { routeSchema, searchPlacesSchema, type RouteQuery, type SearchPlacesQuery } from '../validators/maps.js';

export interface MapsRouterOptions {
  requireAuth: RequestHandler;
  maps: MapsProvider;
  rateLimitEnabled: boolean;
}

const FIVE_MINUTES = 5 * 60 * 1000;

// Place search and route preview go through our server so the browser never talks to the map
// services directly: one place to rate-limit, cache, and later swap the provider.
export function createMapsRouter({ requireAuth, maps, rateLimitEnabled }: MapsRouterOptions): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/places',
    makeLimiter(rateLimitEnabled, { windowMs: FIVE_MINUTES, limit: 150 }),
    validateQuery(searchPlacesSchema),
    async (_req, res) => {
      const { q, lat, lng } = res.locals.query as SearchPlacesQuery;
      const bias = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
      res.json({ success: true, data: { places: await maps.searchPlaces(q, bias) } });
    },
  );

  router.get(
    '/route',
    makeLimiter(rateLimitEnabled, { windowMs: FIVE_MINUTES, limit: 60 }),
    validateQuery(routeSchema),
    async (_req, res) => {
      const q = res.locals.query as RouteQuery;
      const route = await maps.getRoute({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng });
      res.json({ success: true, data: { route } });
    },
  );

  return router;
}
