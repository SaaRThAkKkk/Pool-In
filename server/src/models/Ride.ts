import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ACTIVE_RIDE_STATUSES } from '../config/rides.js';
import { VEHICLE_CATEGORY_KEYS } from '../config/vehicles.js';

export const RIDE_TYPES = ['BOOKED_CAB', 'OWNER_VEHICLE', 'PASSENGER_GROUP'] as const;
export const RIDE_STATUSES = [
  'DRAFT',
  'OPEN',
  'MATCHING',
  'PARTIALLY_FILLED',
  'FULL',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const PRICING_MODES = ['FIXED', 'NEGOTIABLE'] as const;

// Coordinates are optional until place search exists; matching will need them.
const locationSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    coordinates: {
      type: new Schema({ lat: { type: Number, required: true }, lng: { type: Number, required: true } }, { _id: false }),
      required: false,
    },
  },
  { _id: false },
);

const rideSchema = new Schema(
  {
    rideType: { type: String, enum: RIDE_TYPES, required: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    departureAt: { type: Date, required: true },
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
    passengerCapacity: { type: Number, required: true, min: 1 }, // seats the owner is offering in total
    availableSeats: { type: Number, required: true, min: 0 },
    currentPassengerCount: { type: Number, default: 0, min: 0 },
    pricingMode: { type: String, enum: PRICING_MODES, required: true },
    askingPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    priceBasis: { type: String, enum: ['PER_PASSENGER'], default: 'PER_PASSENGER' },
    rideStatus: { type: String, enum: RIDE_STATUSES, default: 'OPEN', index: true },
    // Normalised route + time, used to reject accidental duplicate listings atomically.
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true },
);

rideSchema.index({ ownerUserId: 1, createdAt: -1 });
rideSchema.index({ rideStatus: 1, departureAt: 1 });
// One active listing per owner per route and departure time (race-safe duplicate guard).
rideSchema.index(
  { ownerUserId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { rideStatus: { $in: [...ACTIVE_RIDE_STATUSES] } } },
);

export type RideRecord = InferSchemaType<typeof rideSchema>;
export type RideDocument = HydratedDocument<RideRecord>;
export const Ride = model('Ride', rideSchema);

// Shape returned to the owner. Other users will get a reduced view (no precise coordinates) when
// search and join are built.
export function toOwnerRideDto(ride: RideDocument) {
  const loc = (l: RideDocument['origin']) => ({
    label: l.label,
    ...(l.coordinates ? { coordinates: { lat: l.coordinates.lat, lng: l.coordinates.lng } } : {}),
  });
  return {
    id: ride._id.toString(),
    rideType: ride.rideType,
    origin: loc(ride.origin),
    destination: loc(ride.destination),
    departureAt: ride.departureAt,
    vehicle: { category: ride.vehicle.category, make: ride.vehicle.make, model: ride.vehicle.model },
    seats: {
      offered: ride.passengerCapacity,
      available: ride.availableSeats,
      taken: ride.currentPassengerCount,
    },
    pricing: {
      amount: ride.askingPrice,
      currency: ride.currency,
      basis: ride.priceBasis,
      negotiable: ride.pricingMode === 'NEGOTIABLE',
    },
    status: ride.rideStatus,
    createdAt: ride.createdAt,
  };
}
export type OwnerRideDto = ReturnType<typeof toOwnerRideDto>;
