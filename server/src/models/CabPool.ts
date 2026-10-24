import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { MATCHING } from '../config/matching.js';
import { ACTIVE_CAB_STATUSES, CAB_COLLECTION } from '../config/pools.js';
import { locationSchema, luggageSchema, pointSchema } from './poolParts.js';
import { poolsDb } from './poolsDb.js';

// SEARCHING: looking for a car-owner pool during the five-minute window.
// SEARCH_TIMED_OUT: the window ended; the user chooses to create a passenger-pooling request or edit the search.
// OPEN: a passenger-pooling request, visible to other passengers' matching.
export const CAB_STATUSES = ['SEARCHING', 'SEARCH_TIMED_OUT', 'OPEN', 'MATCHED', 'CONFIRMED', 'CANCELLED', 'EXPIRED'] as const;

// Section 2: people without a vehicle who want to share a cab. Each document is a passenger request that
// matching tries to pair with car-owner pools, and (once the user asks) with other passengers' requests.
const cabPoolSchema = new Schema(
  {
    // References a user in the MAIN database, so it cannot be populated.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    originPoint: { type: pointSchema, required: false },
    destinationPoint: { type: pointSchema, required: false },
    arriveBy: { type: Date, required: true },
    luggage: { type: luggageSchema, required: true },
    peopleCount: { type: Number, required: true, min: 1 }, // people travelling together (seats needed)

    // --- Matching ---------------------------------------------------------------------------------------------
    /** Most the passenger will travel by road to reach the agreed pickup point. */
    maxPickupTravelKm: {
      type: Number,
      default: MATCHING.DEFAULT_MAX_PICKUP_TRAVEL_KM,
      min: 0,
      max: MATCHING.MAX_PICKUP_TRAVEL_KM,
    },
    /** Optional: most they will travel by road from the drop-off to their destination. */
    maxDropoffTravelKm: { type: Number, min: 0, max: MATCHING.MAX_DROPOFF_TRAVEL_KM, required: false },
    /** Optional: most they want to pay per person. */
    maxBudget: { type: Number, min: 0, required: false },

    // --- The five-minute search ------------------------------------------------------------------------------
    searchStartedAt: { type: Date, required: false },
    searchExpiresAt: { type: Date, required: false },
    /** When new car-owner pools were last checked; only pools published after this are checked next time. */
    searchCheckedAt: { type: Date, required: false },
    /** Matches found so far (already validated), best first. Kept small. */
    matches: { type: [Schema.Types.Mixed], default: [] },

    status: { type: String, enum: CAB_STATUSES, default: 'OPEN', index: true },
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true },
);

cabPoolSchema.index({ userId: 1, createdAt: -1 });
cabPoolSchema.index({ status: 1, arriveBy: 1 });
// "Which searches are running right now?" (a new car-owner pool is checked against just these)
cabPoolSchema.index({ status: 1, searchExpiresAt: 1 });
cabPoolSchema.index({ originPoint: '2dsphere' });
cabPoolSchema.index({ destinationPoint: '2dsphere' });
cabPoolSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: [...ACTIVE_CAB_STATUSES] } } },
);

export type CabPoolRecord = InferSchemaType<typeof cabPoolSchema>;
export type CabPoolDocument = HydratedDocument<CabPoolRecord>;
// Registered on the pools database, in the cab_pools collection.
export const CabPool = poolsDb.model('CabPool', cabPoolSchema, CAB_COLLECTION);
