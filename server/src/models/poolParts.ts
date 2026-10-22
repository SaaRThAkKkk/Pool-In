import { Schema } from 'mongoose';
import { POOL_POLICY } from '../config/pools.js';

// Pieces shared by both pool sections, so a search can treat them uniformly.

// Coordinates are optional: they are missing only when place search was down.
export const locationSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    coordinates: {
      type: new Schema({ lat: { type: Number, required: true }, lng: { type: Number, required: true } }, { _id: false }),
      required: false,
    },
  },
  { _id: false },
);

// GeoJSON point ([lng, lat]) derived from the coordinates, so "pools starting/ending near here" can use
// MongoDB's geospatial index. Absent when a place has no coordinates.
export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: { validator: (v: number[]) => v.length === 2, message: 'a point needs [lng, lat]' },
    },
  },
  { _id: false },
);

export const LUGGAGE_TYPES = ['large', 'medium', 'cabin', 'backpack', 'oversized'] as const;
export type Luggage = Record<(typeof LUGGAGE_TYPES)[number], number>;

const count = { type: Number, default: 0, min: 0, max: POOL_POLICY.MAX_LUGGAGE_PER_TYPE };
// Counts per category (PRD 4.1). Dimensions and volume estimates come with the matching work.
export const luggageSchema = new Schema(
  { large: count, medium: count, cabin: count, backpack: count, oversized: count },
  { _id: false },
);

export const toPoint = (c?: { lat: number; lng: number }) =>
  c ? ({ type: 'Point' as const, coordinates: [c.lng, c.lat] as [number, number] }) : undefined;

export const emptyLuggage = (): Luggage => ({ large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 });
