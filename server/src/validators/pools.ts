import { z } from 'zod';
import { POOL_POLICY } from '../config/pools.js';
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

const luggageCount = z
  .number({ error: 'Enter a number' })
  .int('Whole numbers only')
  .min(0, 'Cannot be negative')
  .max(POOL_POLICY.MAX_LUGGAGE_PER_TYPE, `At most ${POOL_POLICY.MAX_LUGGAGE_PER_TYPE} of each`)
  .default(0);

// What every pool needs, whichever way the user chooses to pool.
const common = {
  origin: location('starting location'),
  destination: location('destination'),
  // The time the user needs to reach the destination. ISO-8601 with an offset (the browser sends UTC);
  // lead-time limits are checked in the service.
  arriveBy: z.iso
    .datetime({ offset: true, error: 'Enter a valid date and time to arrive by' })
    .transform((v) => new Date(v)),
  luggage: z
    .object({
      large: luggageCount,
      medium: luggageCount,
      cabin: luggageCount,
      backpack: luggageCount,
      oversized: luggageCount,
    })
    .default({ large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 }),
};

type Route = { origin: z.infer<ReturnType<typeof location>>; destination: z.infer<ReturnType<typeof location>> };

function checkRoute(v: Route, ctx: z.RefinementCtx) {
  const sameLabel = normalizeLabel(v.origin.label) === normalizeLabel(v.destination.label);
  const tooClose =
    v.origin.coordinates &&
    v.destination.coordinates &&
    distanceMetres(v.origin.coordinates, v.destination.coordinates) < POOL_POLICY.MIN_DISTINCT_METRES;
  if (sameLabel || tooClose) {
    ctx.addIssue({
      code: 'custom',
      path: ['destination', 'label'],
      message: 'Destination must be different from the starting location',
    });
  }
}

// "I own the vehicle": offer seats on a trip. Saved in the car-owner section.
export const ownVehicleSchema = z
  .object({
    mode: z.literal('OWN_VEHICLE'),
    ...common,
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
      .max(POOL_POLICY.MAX_FARE, `Fare cannot exceed ${POOL_POLICY.MAX_FARE.toLocaleString('en-IN')}`)
      .refine(hasAtMostTwoDecimals, 'Fare can have at most 2 decimal places'),
    negotiable: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const max = VEHICLE_CATEGORIES[v.vehicle.category].maxPassengers;
    if (v.seats > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['seats'],
        message: `A ${VEHICLE_CATEGORIES[v.vehicle.category].label} can offer at most ${max} seats`,
      });
    }
    checkRoute(v, ctx);
  });

// "Pool a cab": look for a matching pool first; if there is none, save a request in the cab section.
export const poolCabSchema = z
  .object({
    mode: z.literal('POOL_CAB'),
    ...common,
    people: z
      .number({ error: 'Enter how many people are travelling' })
      .int('Whole numbers only')
      .min(1, 'At least 1 person')
      .max(POOL_POLICY.MAX_PEOPLE, `At most ${POOL_POLICY.MAX_PEOPLE} people`),
  })
  .superRefine(checkRoute);

export const poolInSchema = z.discriminatedUnion('mode', [ownVehicleSchema, poolCabSchema], {
  error: 'Choose how you want to pool',
});

export type OwnVehicleInput = z.infer<typeof ownVehicleSchema>;
export type PoolCabInput = z.infer<typeof poolCabSchema>;
export type PoolInInput = z.infer<typeof poolInSchema>;
