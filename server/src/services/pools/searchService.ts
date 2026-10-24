import { MATCHING } from '../../config/matching.js';
import { ACTIVE_CAB_STATUSES, POOL_POLICY } from '../../config/pools.js';
import { CabPool, type CabPoolDocument } from '../../models/CabPool.js';
import { CarOwnerPool, type CarOwnerPoolDocument } from '../../models/CarOwnerPool.js';
import type { UserDocument } from '../../models/User.js';
import { conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { mapLimit } from '../../utils/mapLimit.js';
import type { PoolCabInput } from '../../validators/pools.js';
import { toOwnerCandidate, toPassengerRequest } from '../matching/candidateRepository.js';
import { luggageUnits } from '../matching/luggage.js';
import { rankOwnerMatches, type PoolMatcher } from '../matching/matcher.js';
import type { NearbyPool, OwnerMatch, OwnerSearchResult, PassengerMatch, PassengerRequest, PassengerSearchResult } from '../matching/types.js';
import type { SearchNotifier } from '../realtime/notifier.js';
import { baseFields, checkArrivalWindow, duplicate, expireStaleSearches, isDuplicateKeyError, tooManyActive } from './poolCommon.js';

export interface SearchDeps {
  matcher: PoolMatcher;
  notifier: SearchNotifier;
}

const KEEP_MATCHES = 10;

// What the matching code needs, taken straight from what the passenger submitted (before it is saved).
function requestFromInput(userId: string, input: PoolCabInput): PassengerRequest | null {
  const o = input.origin.coordinates;
  const d = input.destination.coordinates;
  if (!o || !d) return null;
  return {
    userId,
    origin: o,
    destination: d,
    arriveBy: input.arriveBy,
    people: input.people,
    luggageUnits: luggageUnits(input.luggage),
    maxPickupTravelKm: input.maxPickupTravelKm ?? MATCHING.DEFAULT_MAX_PICKUP_TRAVEL_KM,
    ...(input.maxDropoffTravelKm !== undefined ? { maxDropoffTravelKm: input.maxDropoffTravelKm } : {}),
    ...(input.maxBudget !== undefined ? { maxBudget: input.maxBudget } : {}),
  };
}

const cabFields = (user: UserDocument, input: PoolCabInput) => ({
  ...baseFields(user, input),
  peopleCount: input.people,
  maxPickupTravelKm: input.maxPickupTravelKm ?? MATCHING.DEFAULT_MAX_PICKUP_TRAVEL_KM,
  ...(input.maxDropoffTravelKm !== undefined ? { maxDropoffTravelKm: input.maxDropoffTravelKm } : {}),
  ...(input.maxBudget !== undefined ? { maxBudget: input.maxBudget } : {}),
});

export type StartSearchResult =
  /** A feasible car-owner pool already exists. Nothing is created; the matches are shown instead. */
  | { outcome: 'MATCHES_FOUND'; matching: OwnerSearchResult }
  /** None yet. A five-minute search is now running and will pick up newly published pools. */
  | { outcome: 'SEARCH_STARTED'; pool: CabPoolDocument; matching: OwnerSearchResult }
  /** The request has no coordinates (place search was down), so it cannot be matched. It is saved as a plain request. */
  | { outcome: 'REQUEST_CREATED'; pool: CabPoolDocument; matching: null };

// "Pool a cab": run the matching algorithm immediately; only if nothing feasible exists, start the five-minute search.
export async function startSearch(
  user: UserDocument,
  input: PoolCabInput,
  deps: SearchDeps,
  now = new Date(),
): Promise<StartSearchResult> {
  checkArrivalWindow(input.arriveBy, now);

  await expireStaleSearches(user._id, now);
  const active = await CabPool.countDocuments({ userId: user._id, status: { $in: [...ACTIVE_CAB_STATUSES] } });
  if (active >= POOL_POLICY.MAX_ACTIVE_PER_USER) throw tooManyActive();

  const request = requestFromInput(user.id, input);
  if (!request) {
    const pool = await create({ ...cabFields(user, input), status: 'OPEN' });
    return { outcome: 'REQUEST_CREATED', pool, matching: null };
  }

  const matching = await deps.matcher.findOwnerMatches(request, { now });
  if (matching.matches.length > 0) return { outcome: 'MATCHES_FOUND', matching };

  const pool = await create({
    ...cabFields(user, input),
    status: 'SEARCHING',
    searchStartedAt: now,
    searchExpiresAt: new Date(now.getTime() + MATCHING.SEARCH_WINDOW_MS),
    // If some pools could not be checked (routing trouble), leave this empty so the next check looks at them all again.
    ...(matching.status === 'OK' ? { searchCheckedAt: now } : {}),
  });
  return { outcome: 'SEARCH_STARTED', pool, matching };
}

async function create(fields: Record<string, unknown>): Promise<CabPoolDocument> {
  try {
    return await CabPool.create(fields);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw duplicate();
    throw err;
  }
}

async function loadOwn(user: UserDocument, id: string, now: Date): Promise<CabPoolDocument> {
  await expireStaleSearches(user._id, now);
  const doc = await CabPool.findOne({ _id: id, userId: user._id });
  if (!doc) throw notFound('Search not found');
  return doc;
}

// Matches found earlier are only kept if their pool still has room. Seats are re-read from the live record.
async function stillAvailable(matches: OwnerMatch[], people: number): Promise<OwnerMatch[]> {
  if (matches.length === 0) return [];
  const pools = await CarOwnerPool.find({
    _id: { $in: matches.map((m) => m.poolId) },
    status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
    availableSeats: { $gte: people },
  }).select('availableSeats');
  const seats = new Map(pools.map((p) => [p._id.toString(), p.availableSeats]));
  return matches.filter((m) => seats.has(m.poolId)).map((m) => ({ ...m, seatsAvailable: seats.get(m.poolId)! }));
}

const merge = (current: OwnerMatch[], incoming: OwnerMatch[]) => {
  const byPool = new Map(current.map((m) => [m.poolId, m]));
  for (const m of incoming) byPool.set(m.poolId, m);
  return rankOwnerMatches([...byPool.values()]).slice(0, KEEP_MATCHES);
};

export interface SearchState {
  id: string;
  /** SEARCHING while the five minutes run; OPEN once they are over (the request is then posted for other passengers). */
  status: string;
  windowSeconds: number;
  expiresAt: string | null;
  remainingSeconds: number;
  matches: OwnerMatch[];
  /** DEGRADED: routing trouble meant some pools could not be checked this time. */
  matching: { status: 'OK' | 'DEGRADED' };
  /** When no pool fits: the closest ones anyway, each with the reasons it does not fit. Never matches. */
  nearest: NearbyPool[];
  /** Other passengers whose open requests could share a cab with this one. Proposed groups, not confirmed rides. */
  groups: PassengerMatch[];
  /** True once the search ended with no pool and the request was posted so other passengers can find it. */
  postedForOthers: boolean;
}

const toState = (
  doc: CabPoolDocument,
  parts: { matches?: OwnerMatch[]; degraded?: boolean; nearest?: NearbyPool[]; groups?: PassengerMatch[] },
  now: Date,
): SearchState => ({
  id: doc._id.toString(),
  status: doc.status,
  windowSeconds: MATCHING.SEARCH_WINDOW_MS / 1000,
  expiresAt: doc.searchExpiresAt ? doc.searchExpiresAt.toISOString() : null,
  remainingSeconds:
    doc.status === 'SEARCHING' && doc.searchExpiresAt ? Math.max(0, Math.ceil((doc.searchExpiresAt.getTime() - now.getTime()) / 1000)) : 0,
  matches: parts.matches ?? [],
  matching: { status: parts.degraded ? 'DEGRADED' : 'OK' },
  nearest: parts.nearest ?? [],
  groups: parts.groups ?? [],
  postedForOthers: doc.status === 'OPEN' && Boolean(doc.searchStartedAt),
});

// Everything the search screen shows besides the owner matches: the closest pools that do not fit (only when nothing
// fits) and any other passengers whose open requests could share a cab. A failure here must not break the search.
async function extras(request: PassengerRequest, hasMatches: boolean, deps: SearchDeps, now: Date) {
  const [nearest, groups] = await Promise.all([
    hasMatches ? [] : deps.matcher.findNearestOwnerPools(request, { now }).catch((err) => (logger.warn({ err }, 'nearest pools failed'), [])),
    deps.matcher
      .findPassengerMatches(request, { now })
      .then((r) => r.matches)
      .catch((err) => (logger.warn({ err }, 'passenger groups failed'), [])),
  ]);
  return { nearest, groups };
}

// The state of a search. While it runs, each call checks only car-owner pools published since the last check
// (never the whole database), merges what it finds, and drops matches whose pool has since filled up. After the
// five minutes the request is open to other passengers, and the owner pools are checked in full each time.
export async function getSearch(user: UserDocument, id: string, deps: SearchDeps, now = new Date()): Promise<SearchState> {
  const doc = await loadOwn(user, id, now);
  if (doc.status !== 'SEARCHING' && doc.status !== 'OPEN') return toState(doc, {}, now);

  const request = toPassengerRequest(doc);
  if (!request) return toState(doc, {}, now);

  if (doc.status === 'OPEN') {
    const result = await deps.matcher.findOwnerMatches(request, { now });
    return toState(doc, { matches: result.matches, degraded: result.status === 'DEGRADED', ...(await extras(request, result.matches.length > 0, deps, now)) }, now);
  }

  const result = await deps.matcher.findOwnerMatches(request, { now, createdAfter: doc.searchCheckedAt ?? undefined });
  const matches = merge(await stillAvailable(asMatches(doc), doc.peopleCount), result.matches);

  await CabPool.updateOne(
    { _id: doc._id, status: 'SEARCHING' },
    // Only move the "already checked" mark forward when every pool was really checked.
    { $set: { matches, ...(result.status === 'OK' ? { searchCheckedAt: now } : {}) } },
  );
  return toState(doc, { matches, degraded: result.status === 'DEGRADED', ...(await extras(request, matches.length > 0, deps, now)) }, now);
}

const asMatches = (doc: CabPoolDocument) => (doc.matches ?? []) as unknown as OwnerMatch[];

export async function cancelSearch(user: UserDocument, id: string, now = new Date()): Promise<void> {
  await expireStaleSearches(user._id, now);
  const res = await CabPool.updateOne(
    { _id: id, userId: user._id, status: { $in: ['SEARCHING', 'SEARCH_TIMED_OUT', 'OPEN'] } },
    { status: 'CANCELLED', matches: [] },
  );
  if (res.matchedCount === 0) {
    const exists = await CabPool.exists({ _id: id, userId: user._id });
    if (!exists) throw notFound('Search not found');
    throw conflict('SEARCH_NOT_ACTIVE', 'This search is not running any more.');
  }
}

export interface PassengerGroups {
  pool: CabPoolDocument;
  groups: PassengerSearchResult;
}

// After the window ends the user can ask to be matched with other passengers instead. The request becomes visible
// to other passengers, and any compatible ones are proposed as a group (not a confirmed ride).
export async function createPoolingRequest(user: UserDocument, id: string, deps: SearchDeps, now = new Date()): Promise<PassengerGroups> {
  const doc = await loadOwn(user, id, now);
  if (doc.status === 'SEARCHING') {
    throw conflict('SEARCH_STILL_RUNNING', 'The search is still looking for a car-owner pool. Wait for it to end first.');
  }

  let pool = doc;
  if (doc.status === 'SEARCH_TIMED_OUT') {
    const updated = await CabPool.findOneAndUpdate(
      { _id: doc._id, userId: user._id, status: 'SEARCH_TIMED_OUT' },
      { status: 'OPEN', matches: [] },
      { returnDocument: 'after' },
    );
    if (!updated) throw conflict('SEARCH_NOT_ACTIVE', 'This search has already been changed.');
    pool = updated;
  } else if (doc.status !== 'OPEN') {
    throw conflict('SEARCH_NOT_ACTIVE', 'This request cannot be turned into a passenger-pooling request.');
  }

  return { pool, groups: await groupsFor(pool, deps, now) };
}

export async function getPassengerMatches(user: UserDocument, id: string, deps: SearchDeps, now = new Date()): Promise<PassengerGroups> {
  const doc = await loadOwn(user, id, now);
  if (doc.status !== 'OPEN') throw conflict('NOT_A_POOLING_REQUEST', 'Only an open passenger-pooling request can be matched with other passengers.');
  return { pool: doc, groups: await groupsFor(doc, deps, now) };
}

async function groupsFor(doc: CabPoolDocument, deps: SearchDeps, now: Date): Promise<PassengerSearchResult> {
  const request = toPassengerRequest(doc);
  if (!request) return { status: 'NEEDS_COORDINATES', matches: [], checked: 0, routingFailures: 0, rejected: {} };
  return deps.matcher.findPassengerMatches(request, { now });
}

// A new car-owner pool has just been published: check it against the searches that are running right now (only
// those, never everyone), save any match, and tell the passenger straight away.
export async function onOwnerPoolPublished(pool: CarOwnerPoolDocument, deps: SearchDeps, now = new Date()): Promise<number> {
  const candidate = toOwnerCandidate(pool);
  if (!candidate) return 0;

  const searches = await CabPool.find({
    status: 'SEARCHING',
    searchExpiresAt: { $gt: now },
    userId: { $ne: pool.userId },
  }).limit(100);

  let notified = 0;
  await mapLimit(searches, 3, async (search) => {
    try {
      const request = toPassengerRequest(search);
      if (!request) return;

      const match = await deps.matcher.evaluatePool(request, candidate, now);
      if (!match || match === 'ROUTING_ERROR') return; // not a match, or could not be verified: the next poll retries

      const matches = merge(asMatches(search), [match]);
      const res = await CabPool.updateOne({ _id: search._id, status: 'SEARCHING' }, { $set: { matches } });
      if (res.modifiedCount > 0) {
        deps.notifier.notifyUser(search.userId.toString(), 'search:update', { searchId: search._id.toString() });
        notified += 1;
      }
    } catch (err) {
      logger.warn({ err }, 'could not check a new pool against a running search');
    }
  });
  return notified;
}

