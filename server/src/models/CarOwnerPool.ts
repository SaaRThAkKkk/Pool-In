import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  ACTIVE_CAR_OWNER_STATUSES,
  CAR_OWNER_COLLECTION,
} from '../config/pools.js';
import { VEHICLE_CATEGORY_KEYS } from '../config/vehicles.js';
import { MATCHING } from '../config/matching.js';
import { lineStringSchema, locationSchema, luggageSchema, pointSchema } from './poolParts.js';
import { poolsDb } from './poolsDb.js';

export const CAR_OWNER_STATUSES = [
  'OPEN',
  'PARTIALLY_FILLED',
  'FULL',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const PRICING_MODES = ['FIXED', 'NEGOTIABLE'] as const;

// Section 1: people who own a vehicle and are offering seats on a trip they are making.
const carOwnerPoolSchema = new Schema(
  {
    // References a user in the MAIN database (pools live in a separate one), so it cannot be populated.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    originPoint: { type: pointSchema, required: false },
    destinationPoint: { type: pointSchema, required: false },
    arriveBy: { type: Date, required: true }, // the time they need to reach the destination
    luggage: { type: luggageSchema, required: true }, // the owner's own luggage
    // Snapshot of the declared vehicle. Registration numbers are deliberately not collected.
    vehicle: {
      type: new Schema(
        {
          category: { type: String, enum: VEHICLE_CATEGORY_KEYS, required: true },
          make: { type: String, required: true, trim: true, maxlength: 40 },
          model: { type: String, required: true, trim: true, maxlength: 40 },
        },
        { _id: false },
      ),
      required: true,
    },
    // --- Matching ---------------------------------------------------------------------------------------------
    /** The most extra distance the owner will drive to pick someone up. */
    maxDriverDetourKm: {
      type: Number,
      default: MATCHING.DEFAULT_MAX_DRIVER_DETOUR_KM,
      min: 0,
      max: MATCHING.MAX_DRIVER_DETOUR_KM,
    },
    /** Space the owner offers for riders' luggage, in standard-bag units. When absent, a default for the vehicle type is used. */
    luggageSpaceUnits: { type: Number, min: 0, max: 100, required: false },
    /** Luggage space already promised to riders who have joined. */
    luggageUsedUnits: { type: Number, default: 0, min: 0 },
    /** The owner's planned drive, worked out once when the pool is published (not on every search). */
    route: {
      type: new Schema(
        { distanceMeters: Number, durationSeconds: Number, computedAt: Date },
        { _id: false },
      ),
      required: false,
    },
    routeLine: { type: lineStringSchema, required: false },
    /** Riders who have already joined; their stops stay in the itinerary when someone else is matched. */
    confirmedStops: {
      type: [
        new Schema(
          {
            userId: Schema.Types.ObjectId,
            seats: Number,
            luggageUnits: Number,
            pickup: new Schema({ lat: Number, lng: Number }, { _id: false }),
            dropoff: new Schema({ lat: Number, lng: Number }, { _id: false }),
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    seatsOffered: { type: Number, required: true, min: 1 },
    availableSeats: { type: Number, required: true, min: 0 },
    currentPassengerCount: { type: Number, default: 0, min: 0 },
    pricingMode: { type: String, enum: PRICING_MODES, required: true },
    askingPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    priceBasis: { type: String, enum: ['PER_PASSENGER'], default: 'PER_PASSENGER' },
    status: { type: String, enum: CAR_OWNER_STATUSES, default: 'OPEN', index: true },
    // Normalised route + time, used to reject accidental duplicate listings atomically.
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true },
);

carOwnerPoolSchema.index({ userId: 1, createdAt: -1 });
// Search: open pools arriving in a time window, then narrowed by seats, price, vehicle and distance.
carOwnerPoolSchema.index({ status: 1, arriveBy: 1 });
carOwnerPoolSchema.index({ status: 1, availableSeats: 1, askingPrice: 1 });
carOwnerPoolSchema.index({ status: 1, 'vehicle.category': 1, arriveBy: 1 });
carOwnerPoolSchema.index({ originPoint: '2dsphere' });
carOwnerPoolSchema.index({ destinationPoint: '2dsphere' });
// "Which routes pass near this pickup and this destination?" (a driver's route can pass a passenger far from their start)
carOwnerPoolSchema.index({ routeLine: '2dsphere' });
// One active listing per user per route and arrival time (race-safe duplicate guard).
carOwnerPoolSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: [...ACTIVE_CAR_OWNER_STATUSES] } } },
);

export type CarOwnerPoolRecord = InferSchemaType<typeof carOwnerPoolSchema>;
export type CarOwnerPoolDocument = HydratedDocument<CarOwnerPoolRecord>;
// Registered on the pools database, in the car_owner_pools collection.
export const CarOwnerPool = poolsDb.model('CarOwnerPool', carOwnerPoolSchema, CAR_OWNER_COLLECTION);
