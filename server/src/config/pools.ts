// Pool policy. Initial defaults, tune with real usage.
export const POOL_POLICY = {
  MIN_LEAD_MS: 10 * 60 * 1000, // arrive-by time must be at least 10 minutes away
  MAX_LEAD_MS: 90 * 24 * 60 * 60 * 1000, // and no more than 90 days away
  MAX_ACTIVE_PER_USER: 10, // per section
  MAX_FARE: 100_000,
  MIN_DISTINCT_METRES: 200, // start and end must be at least this far apart when both have coordinates
  MAX_LUGGAGE_PER_TYPE: 10,
  MAX_PEOPLE: 6, // people travelling together in a cab request
} as const;

// Pools are kept in two sections (collections) of the pools database.
export const POOL_SECTIONS = ['CAR_OWNER', 'CAB'] as const;
export type PoolSection = (typeof POOL_SECTIONS)[number];

export const CAR_OWNER_COLLECTION = 'car_owner_pools';
export const CAB_COLLECTION = 'cab_pools';

// Statuses that still occupy a slot for the user (anything not finished or cancelled).
export const ACTIVE_CAR_OWNER_STATUSES = ['OPEN', 'PARTIALLY_FILLED', 'FULL', 'CONFIRMED', 'IN_PROGRESS'] as const;
export const ACTIVE_CAB_STATUSES = ['OPEN', 'MATCHED', 'CONFIRMED'] as const;
