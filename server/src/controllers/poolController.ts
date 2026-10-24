import type { RequestHandler } from 'express';
import { MATCHING } from '../config/matching.js';
import { toCabPoolDto, toCarOwnerPoolDto } from '../models/poolDto.js';
import type { PoolMatcher } from '../services/matching/matcher.js';
import type { MapsProvider } from '../services/maps/types.js';
import type { SearchNotifier } from '../services/realtime/notifier.js';
import { createCarOwnerPool, getMyPool, listMyPools } from '../services/pools/poolService.js';
import {
  cancelSearch,
  createPoolingRequest,
  getPassengerMatches,
  getSearch,
  onOwnerPoolPublished,
  startSearch,
} from '../services/pools/searchService.js';
import { logger } from '../utils/logger.js';
import type { PoolInInput } from '../validators/pools.js';

export interface PoolControllerDeps {
  matcher: PoolMatcher;
  maps: MapsProvider;
  notifier: SearchNotifier;
}

export function makePoolController(deps: PoolControllerDeps) {
  // One entry point for both ways of pooling; `mode` decides which section the pool is saved in.
  const poolIn: RequestHandler = async (req, res) => {
    const input = req.body as PoolInInput;

    if (input.mode === 'OWN_VEHICLE') {
      const pool = await createCarOwnerPool(req.user!, input, deps);

      // Passengers already searching may fit this new pool. Never let that delay or fail the owner's request.
      await Promise.race([
        onOwnerPoolPublished(pool, deps).catch((err) => logger.warn({ err }, 'checking running searches failed')),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      res.status(201).json({
        success: true,
        data: { outcome: 'POOL_CREATED', section: 'CAR_OWNER', pool: toCarOwnerPoolDto(pool) },
      });
      return;
    }

    const result = await startSearch(req.user!, input, deps);

    if (result.outcome === 'MATCHES_FOUND') {
      // Nothing is created when a feasible pool exists: the user is shown the matches instead.
      res.json({ success: true, data: { outcome: 'MATCHES_FOUND', matching: result.matching } });
      return;
    }
    if (result.outcome === 'SEARCH_STARTED') {
      res.status(201).json({
        success: true,
        data: {
          outcome: 'SEARCH_STARTED',
          section: 'CAB',
          pool: toCabPoolDto(result.pool),
          windowSeconds: MATCHING.SEARCH_WINDOW_MS / 1000,
          matching: { status: result.matching.status, matches: [] },
        },
      });
      return;
    }
    res.status(201).json({
      success: true,
      data: { outcome: 'REQUEST_CREATED', section: 'CAB', pool: toCabPoolDto(result.pool), matching: { status: 'NEEDS_COORDINATES', matches: [] } },
    });
  };

  const mine: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { pools: await listMyPools(req.user!) } });
  };

  const getOne: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { pool: await getMyPool(req.user!, String(req.params.id)) } });
  };

  const search: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { search: await getSearch(req.user!, String(req.params.id), deps) } });
  };

  const stopSearch: RequestHandler = async (req, res) => {
    await cancelSearch(req.user!, String(req.params.id));
    res.json({ success: true, data: {} });
  };

  const poolingRequest: RequestHandler = async (req, res) => {
    const { pool, groups } = await createPoolingRequest(req.user!, String(req.params.id), deps);
    res.json({ success: true, data: { pool: toCabPoolDto(pool), groups } });
  };

  const passengerMatches: RequestHandler = async (req, res) => {
    const { groups } = await getPassengerMatches(req.user!, String(req.params.id), deps);
    res.json({ success: true, data: { groups } });
  };

  return { poolIn, mine, getOne, search, stopSearch, poolingRequest, passengerMatches };
}
