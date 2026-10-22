import type { PoolSection } from '../config/pools.js';
import type { CabPoolDocument } from './CabPool.js';
import type { CarOwnerPoolDocument } from './CarOwnerPool.js';
import { emptyLuggage, type Luggage } from './poolParts.js';

type Loc = CarOwnerPoolDocument['origin'];
const loc = (l: Loc) => ({
  label: l.label,
  ...(l.coordinates ? { coordinates: { lat: l.coordinates.lat, lng: l.coordinates.lng } } : {}),
});

type LuggageDoc = Partial<Record<keyof Luggage, number | null | undefined>> | null | undefined;
const luggage = (l: LuggageDoc): Luggage => {
  const out = emptyLuggage();
  for (const key of Object.keys(out) as (keyof Luggage)[]) out[key] = l?.[key] ?? 0;
  return out;
};

// The shapes returned to the pool's own user. Other users will get a reduced view (no precise
// coordinates) when search and join are built.
function common(pool: CarOwnerPoolDocument | CabPoolDocument, section: PoolSection) {
  return {
    id: pool._id.toString(),
    section,
    origin: loc(pool.origin),
    destination: loc(pool.destination),
    arriveBy: pool.arriveBy,
    luggage: luggage(pool.luggage),
    status: pool.status as string,
    createdAt: pool.createdAt,
  };
}

export function toCarOwnerPoolDto(pool: CarOwnerPoolDocument) {
  return {
    ...common(pool, 'CAR_OWNER'),
    vehicle: { category: pool.vehicle.category, make: pool.vehicle.make, model: pool.vehicle.model },
    seats: { offered: pool.seatsOffered, available: pool.availableSeats, taken: pool.currentPassengerCount },
    pricing: {
      amount: pool.askingPrice,
      currency: pool.currency,
      basis: pool.priceBasis,
      negotiable: pool.pricingMode === 'NEGOTIABLE',
    },
  };
}

export function toCabPoolDto(pool: CabPoolDocument) {
  return { ...common(pool, 'CAB'), people: pool.peopleCount };
}

export type CarOwnerPoolDto = ReturnType<typeof toCarOwnerPoolDto>;
export type CabPoolDto = ReturnType<typeof toCabPoolDto>;
export type PoolDto = CarOwnerPoolDto | CabPoolDto;
