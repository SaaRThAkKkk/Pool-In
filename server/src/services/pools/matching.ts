import type { PoolSection } from '../../config/pools.js';
import type { Luggage } from '../../models/poolParts.js';

// What a cab request is looking for. The same shape will be used to search both sections.
export interface PoolSearchCriteria {
  userId: string;
  origin: { label: string; coordinates?: { lat: number; lng: number } };
  destination: { label: string; coordinates?: { lat: number; lng: number } };
  arriveBy: Date;
  luggage: Luggage;
  people: number;
}

export interface PoolMatch {
  id: string;
  section: PoolSection;
}

export interface MatchOutcome {
  /** NOT_AVAILABLE: matching is not implemented yet, so nothing was searched. SEARCHED: it ran. */
  status: 'NOT_AVAILABLE' | 'SEARCHED';
  /** Both sections that a search covers. */
  sections: readonly PoolSection[];
  matches: PoolMatch[];
}

export interface PoolMatcher {
  findMatches(criteria: PoolSearchCriteria): Promise<MatchOutcome>;
}

// PLACEHOLDER. The matching algorithm is designed next. When it exists it must search BOTH the
// car-owner section and the cab section (feasibility first: seats, luggage, time, route; then rank).
// Until then it honestly reports that no search happened, so callers never present a made-up result.
export class UnimplementedMatcher implements PoolMatcher {
  async findMatches(): Promise<MatchOutcome> {
    return { status: 'NOT_AVAILABLE', sections: ['CAR_OWNER', 'CAB'], matches: [] };
  }
}
