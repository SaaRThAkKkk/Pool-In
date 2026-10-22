import type { RequestHandler } from 'express';
import { toCabPoolDto, toCarOwnerPoolDto } from '../models/poolDto.js';
import type { PoolMatcher } from '../services/pools/matching.js';
import { createCarOwnerPool, getMyPool, listMyPools, poolACab } from '../services/pools/poolService.js';
import type { PoolInInput } from '../validators/pools.js';

export function makePoolController(matcher: PoolMatcher) {
  // One entry point for both ways of pooling; `mode` decides which section the pool is saved in.
  const poolIn: RequestHandler = async (req, res) => {
    const input = req.body as PoolInInput;

    if (input.mode === 'OWN_VEHICLE') {
      const pool = await createCarOwnerPool(req.user!, input);
      res.status(201).json({
        success: true,
        data: { outcome: 'POOL_CREATED', section: 'CAR_OWNER', pool: toCarOwnerPoolDto(pool) },
      });
      return;
    }

    const result = await poolACab(req.user!, input, matcher);
    if (result.outcome === 'MATCHES_FOUND') {
      // Nothing is created when a match exists: the user is shown the matches instead.
      res.json({ success: true, data: { outcome: 'MATCHES_FOUND', matching: result.matching } });
      return;
    }
    res.status(201).json({
      success: true,
      data: {
        outcome: 'REQUEST_CREATED',
        section: 'CAB',
        matching: result.matching,
        pool: toCabPoolDto(result.pool),
      },
    });
  };

  const mine: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { pools: await listMyPools(req.user!) } });
  };

  const getOne: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { pool: await getMyPool(req.user!, String(req.params.id)) } });
  };

  return { poolIn, mine, getOne };
}
