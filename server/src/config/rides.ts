// Ride listing policy. Initial defaults, tune with real usage.
export const RIDE_POLICY = {
  MIN_LEAD_MS: 10 * 60 * 1000, // departure must be at least 10 minutes away
  MAX_LEAD_MS: 90 * 24 * 60 * 60 * 1000, // and no more than 90 days away
  MAX_ACTIVE_PER_OWNER: 10,
  MAX_FARE: 100_000,
  MIN_DISTINCT_METRES: 200, // start and end must be at least this far apart when both have coordinates
} as const;

// Rides that still occupy a slot in the owner's calendar.
export const ACTIVE_RIDE_STATUSES = ['OPEN', 'PARTIALLY_FILLED', 'FULL', 'CONFIRMED', 'IN_PROGRESS'] as const;
