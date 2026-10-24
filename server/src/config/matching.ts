// Every tunable number of the matching algorithm lives here. These are initial defaults: tune them with
// real trips. Nothing in the algorithm hardcodes a distance, time or weight.
export const MATCHING = {
  /** How long a passenger's search for a car-owner pool runs before the user is asked what to do. */
  SEARCH_WINDOW_MS: 5 * 60 * 1000,

  // Tolerances the user can set. Used when they leave the field blank (pickup, detour) or as upper limits.
  DEFAULT_MAX_DRIVER_DETOUR_KM: 5,
  MAX_DRIVER_DETOUR_KM: 50,
  DEFAULT_MAX_PICKUP_TRAVEL_KM: 2,
  MAX_PICKUP_TRAVEL_KM: 20,
  MAX_DROPOFF_TRAVEL_KM: 20,

  /** The ride must be at least this long, so pickup and drop-off are not the same spot. */
  MIN_RIDE_METRES: 300,

  // Time. All times are worked back from the owner's "reach the destination by" time.
  /** The passenger must not be dropped off earlier than this many minutes before their own deadline. */
  MAX_EARLY_ARRIVAL_MIN: 90,
  /** Arriving within this many minutes before the deadline scores full marks. */
  IDEAL_EARLY_ARRIVAL_MIN: 10,

  // Finding candidates cheaply, before any routing. These only narrow the search; they never accept a match.
  /** Smallest radius around the pickup that a candidate's route must pass through. */
  PREFILTER_PICKUP_RADIUS_KM: 5,
  /** Radius around the destination when the passenger set no drop-off limit. */
  PREFILTER_DROPOFF_RADIUS_KM: 25,
  /** At most this many candidates are checked with real routing per search. */
  MAX_CANDIDATES: 20,
  /** At most this many candidate pickup (and drop-off) points per candidate are checked by road. */
  POINTS_PER_END: 3,
  /** How many ranked matches are returned. */
  MAX_RESULTS: 5,
  /** Stored routes are simplified to at most this many points. */
  ROUTE_MAX_POINTS: 600,

  /** Routing snaps points to the nearest road, so a trip that lies exactly on the route can measure a few metres longer. This much is ignored when working out the driver's extra distance. */
  DETOUR_NOISE_METRES: 100,
  /** Wide window (minutes) used only to narrow candidates in the database; the exact time check follows. */
  TIME_PREFILTER_SLACK_MIN: 360,

  /** Weights of the 0-100 score. Components that do not apply are dropped and the rest re-scaled. */
  WEIGHTS: {
    route: 0.3,
    pickup: 0.2,
    time: 0.15,
    detour: 0.15,
    budget: 0.1,
    dropoff: 0.1,
  },

  /** Luggage is compared in "standard bag" units, so a suitcase counts for more than a backpack. */
  LUGGAGE_UNITS: { large: 2, medium: 1.5, cabin: 1, backpack: 0.5, oversized: 4 },
  /** Boot space for riders when the owner did not say, by vehicle type (before their own luggage). */
  CATEGORY_LUGGAGE_UNITS: { HATCHBACK: 3, SEDAN: 4, SUV: 6, MUV: 8, OTHER: 6 },

  /** Passenger-to-passenger (shared cab, no confirmed vehicle). */
  CAB: {
    MAX_PEOPLE: 4,
    LUGGAGE_UNITS: 6,
    /** The two arrive-by times may differ by at most this many minutes. */
    TIME_WINDOW_MIN: 30,
    /** The two destinations may be at most this far apart (straight line). */
    MAX_DESTINATION_SEPARATION_KM: 10,
    MIN_RIDE_METRES: 1000,
    MAX_RESULTS: 5,
  },
} as const;

export type ScoreKey = keyof typeof MATCHING.WEIGHTS;
