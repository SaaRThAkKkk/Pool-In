import { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ACTIVE_CAB_STATUSES, CAB_COLLECTION } from '../config/pools.js';
import { locationSchema, luggageSchema, pointSchema } from './poolParts.js';
import { poolsDb } from './poolsDb.js';

export const CAB_STATUSES = ['OPEN', 'MATCHED', 'CONFIRMED', 'CANCELLED', 'EXPIRED'] as const;

// Section 2: people without a vehicle who want to share a cab. Each document is a pool request that
// matching will try to pair with other requests or with car-owner pools.
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
    status: { type: String, enum: CAB_STATUSES, default: 'OPEN', index: true },
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true },
);

cabPoolSchema.index({ userId: 1, createdAt: -1 });
cabPoolSchema.index({ status: 1, arriveBy: 1 });
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
