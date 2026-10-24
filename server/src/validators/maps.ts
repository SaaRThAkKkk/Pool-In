import { z } from 'zod';

const lat = z.coerce.number().min(-90, 'Invalid latitude').max(90, 'Invalid latitude');
const lng = z.coerce.number().min(-180, 'Invalid longitude').max(180, 'Invalid longitude');

export const searchPlacesSchema = z
  .object({
    q: z.string().trim().min(2, 'Type at least 2 characters').max(100, 'Search text is too long'),
    lat: lat.optional(),
    lng: lng.optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    path: ['lat'],
    message: 'Send both lat and lng, or neither',
  });
export type SearchPlacesQuery = z.infer<typeof searchPlacesSchema>;

// India's bounding box, so a pin dropped elsewhere is refused (the app only serves India for now).
export const reverseSchema = z
  .object({
    lat: lat.refine((v) => v >= 6.7 && v <= 35.7, 'Choose a place in India'),
    lng: lng.refine((v) => v >= 68.1 && v <= 97.4, 'Choose a place in India'),
  });
export type ReverseQuery = z.infer<typeof reverseSchema>;

export const routeSchema = z.object({ fromLat: lat, fromLng: lng, toLat: lat, toLng: lng });
export type RouteQuery = z.infer<typeof routeSchema>;
