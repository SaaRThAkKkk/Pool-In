import { MATCHING } from '../../config/matching.js';
import { mapLimit } from '../../utils/mapLimit.js';
import type { MapsProvider } from '../maps/types.js';
import { evaluateOwnerCandidate } from './ownerMatching.js';
import { toNearbyPool } from './nearbyPools.js';
import { evaluatePassengerPair } from './passengerMatching.js';
import type {
  NearbyPool,
  OwnerMatch,
  OwnerPoolCandidate,
  OwnerSearchResult,
  PassengerMatch,
  PassengerRequest,
  PassengerSearchResult,
  PeerRequest,
  RejectReason,
  PassengerRejectReason,
} from './types.js';

export interface FindOptions {
  now?: Date;
  /** Only look at car-owner pools published after this moment (used while a search is running). */
  createdAfter?: Date;
  /** Only look at these pools (used to check one newly published pool against a running search). */
  poolIds?: string[];
}

// Where candidates come from. Keeps the ranking logic independent of the database.
export interface CandidateRepository {
  ownerPools(request: PassengerRequest, opts: { now: Date; createdAfter?: Date; poolIds?: string[] }): Promise<OwnerPoolCandidate[]>;
  peerRequests(request: PassengerRequest, opts: { now: Date }): Promise<PeerRequest[]>;
  nearestOwnerPools(request: PassengerRequest, opts: { now: Date; limit: number }): Promise<OwnerPoolCandidate[]>;
}

export interface PoolMatcher {
  /** Scenario A: the passenger against car-owner pools. */
  findOwnerMatches(request: PassengerRequest, opts?: FindOptions): Promise<OwnerSearchResult>;
  /** Scenario B: the passenger against other passengers' open requests (a proposed shared cab). */
  findPassengerMatches(request: PassengerRequest, opts?: { now?: Date }): Promise<PassengerSearchResult>;
  /** The closest pools to the passenger that do NOT fit, each with the reasons why. For when nothing matches. */
  findNearestOwnerPools(request: PassengerRequest, opts?: { now?: Date }): Promise<NearbyPool[]>;
  /** Checks one specific pool against a request, e.g. a pool that has only just been published. */
  evaluatePool(request: PassengerRequest, pool: OwnerPoolCandidate, now?: Date): Promise<OwnerMatch | null | 'ROUTING_ERROR'>;
}

const CONCURRENCY = 4;

const bump = <K extends string>(counts: Partial<Record<K, number>>, key: K) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export class CarpoolMatcher implements PoolMatcher {
  constructor(
    private readonly deps: { maps: MapsProvider; candidates: CandidateRepository },
  ) {}

  async findOwnerMatches(request: PassengerRequest, opts: FindOptions = {}): Promise<OwnerSearchResult> {
    const now = opts.now ?? new Date();
    const candidates = await this.deps.candidates.ownerPools(request, {
      now,
      createdAfter: opts.createdAfter,
      poolIds: opts.poolIds,
    });

    const rejected: Partial<Record<RejectReason, number>> = {};
    let routingFailures = 0;
    const matches: OwnerMatch[] = [];

    const evaluations = await mapLimit(candidates, CONCURRENCY, (pool) =>
      evaluateOwnerCandidate(request, pool, { maps: this.deps.maps, now }),
    );
    for (const e of evaluations) {
      if (e.ok) matches.push(e.match);
      else if (e.reason === 'ROUTING_ERROR') routingFailures += 1;
      else bump(rejected, e.reason);
    }

    return {
      // Never claim a complete search when some candidates could not be checked.
      status: routingFailures > 0 ? 'DEGRADED' : 'OK',
      sections: ['CAR_OWNER', 'CAB'],
      matches: rankOwnerMatches(matches).slice(0, MATCHING.MAX_RESULTS),
      checked: candidates.length - routingFailures,
      routingFailures,
      rejected,
    };
  }

  async findPassengerMatches(request: PassengerRequest, opts: { now?: Date } = {}): Promise<PassengerSearchResult> {
    const now = opts.now ?? new Date();
    const peers = await this.deps.candidates.peerRequests(request, { now });

    const rejected: Partial<Record<PassengerRejectReason, number>> = {};
    let routingFailures = 0;
    const matches: PassengerMatch[] = [];

    const evaluations = await mapLimit(peers, CONCURRENCY, (peer) => evaluatePassengerPair(request, peer, { maps: this.deps.maps, now }));
    for (const e of evaluations) {
      if (e.ok) matches.push(e.match);
      else if (e.reason === 'ROUTING_ERROR') routingFailures += 1;
      else bump(rejected, e.reason);
    }

    return {
      status: routingFailures > 0 ? 'DEGRADED' : 'OK',
      matches: matches.sort((a, b) => b.score - a.score).slice(0, MATCHING.CAB.MAX_RESULTS),
      checked: peers.length - routingFailures,
      routingFailures,
      rejected,
    };
  }

  async findNearestOwnerPools(request: PassengerRequest, opts: { now?: Date } = {}): Promise<NearbyPool[]> {
    const now = opts.now ?? new Date();
    const pools = await this.deps.candidates.nearestOwnerPools(request, { now, limit: MATCHING.NEAREST_POOLS });

    const nearby = await mapLimit(pools, CONCURRENCY, async (pool) => {
      const e = await evaluateOwnerCandidate(request, pool, { maps: this.deps.maps, now });
      // One that actually fits is a match, not a near miss (the normal search shows it).
      if (e.ok || e.reason === 'UNAVAILABLE' || e.reason === 'NO_ROUTE_DATA') return null;
      return toNearbyPool(request, pool, e.reason);
    });
    return nearby.filter((n): n is NearbyPool => n !== null);
  }

  async evaluatePool(request: PassengerRequest, pool: OwnerPoolCandidate, now: Date = new Date()) {
    const e = await evaluateOwnerCandidate(request, pool, { maps: this.deps.maps, now });
    if (e.ok) return e.match;
    return e.reason === 'ROUTING_ERROR' ? ('ROUTING_ERROR' as const) : null;
  }
}

// Best score first. Equal scores: the smaller detour for the driver, then the nearer pickup.
export function rankOwnerMatches(matches: OwnerMatch[]): OwnerMatch[] {
  return [...matches].sort(
    (a, b) =>
      b.score - a.score ||
      a.driverDetourKm - b.driverDetourKm ||
      a.pickup.roadKmFromRequestedPickup - b.pickup.roadKmFromRequestedPickup,
  );
}
