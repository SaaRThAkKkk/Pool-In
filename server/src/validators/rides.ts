import { z } from 'zod';
import { RIDE_POLICY } from '../config/rides.js';
import { VEHICLE_CATEGORIES, VEHICLE_CATEGORY_KEYS } from '../config/vehicles.js';
import { distanceMetres } from '../utils/geo.js';

const coordinates = z.object({
  lat: z.number().min(-90, 'Invalid latitude').max(90, 'Invalid latitude'),
  lng: z.number().min(-180, 'Invalid longitude').max(180, 'Invalid longitude'),
});

const location = (what: string) =>
  z.object({
    label: z.string().trim().min(3, `Enter the ${what}`).max(200, 'Too long (200 characters max)'),
    coordinates: coordinates.optional(),
  });

// Case-, spacing- and edge-whitespace-insensitive form of a place label, for comparing places.
export const normalizeLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const hasAtMostTwoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export const createRideSchema = z
  .object({
    origin: location('starting location'),
    destination: location('destination'),
    // Optional. When given: ISO-8601 with an offset (the browser sends UTC); lead-time limits are checked in the service.
    departureAt: z.iso
      .datetime({ offset: true, error: 'Enter a valid departure date and time' })
      .transform((v) => new Date(v))
      .optional(),
    vehicle: z.object({
      category: z.enum(VEHICLE_CATEGORY_KEYS, { error: 'Choose a vehicle type' }),
      make: z.string().trim().min(2, 'Enter the vehicle make').max(40, 'Too long (40 characters max)'),
      model: z.string().trim().min(1, 'Enter the vehicle model').max(40, 'Too long (40 characters max)'),
    }),
    seats: z
      .number({ error: 'Enter the number of seats' })
      .int('Seats must be a whole number')
      .min(1, 'Offer at least 1 seat'),
    askingPrice: z
      .number({ error: 'Enter the fare' })
      .min(0, 'Fare cannot be negative')
      .max(RIDE_POLICY.MAX_FARE, `Fare cannot exceed ${RIDE_POLICY.MAX_FARE.toLocaleString('en-IN')}`)
      .refine(hasAtMostTwoDecimals, 'Fare can have at most 2 decimal places'),
    negotiable: z.boolean().default(false),
  })
  .superRefine((ride, ctx) => {
    const max = VEHICLE_CATEGORIES[ride.vehicle.category].maxPassengers;
    if (ride.seats > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['seats'],
        message: `A ${VEHICLE_CATEGORIES[ride.vehicle.category].label} can offer at most ${max} seats`,
      });
    }

    const sameLabel = normalizeLabel(ride.origin.label) === normalizeLabel(ride.destination.label);
    const tooClose =
      ride.origin.coordinates &&
      ride.destination.coordinates &&
      distanceMetres(ride.origin.coordinates, ride.destination.coordinates) < RIDE_POLICY.MIN_DISTINCT_METRES;
    if (sameLabel || tooClose) {
      ctx.addIssue({
        code: 'custom',
        path: ['destination', 'label'],
        message: 'Destination must be different from the starting location',
      });
    }
  });

export type CreateRideInput = z.infer<typeof createRideSchema>;
