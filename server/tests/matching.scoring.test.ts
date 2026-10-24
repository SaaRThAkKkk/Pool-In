import { describe, expect, it } from 'vitest';
import { MATCHING } from '../src/config/matching.js';
import { luggageUnits, luggageUnitsAvailable } from '../src/services/matching/luggage.js';
import { budgetScore, combineScores, detourScore, routeScore, timeScore, walkScore } from '../src/services/matching/scoring.js';

describe('configured weights', () => {
  it('are the specified starting weights and add up to 1', () => {
    expect(MATCHING.WEIGHTS).toEqual({ route: 0.3, pickup: 0.2, time: 0.15, detour: 0.15, budget: 0.1, dropoff: 0.1 });
    expect(Object.values(MATCHING.WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('use a five-minute search window', () => {
    expect(MATCHING.SEARCH_WINDOW_MS).toBe(300_000);
  });
});

describe('component scores', () => {
  it('walkScore: 1 at the pickup, 0 at the passenger limit, never outside 0..1', () => {
    expect(walkScore(0, 2)).toBe(1);
    expect(walkScore(1, 2)).toBe(0.5);
    expect(walkScore(2, 2)).toBe(0);
    expect(walkScore(3, 2)).toBe(0);
    expect(walkScore(-1, 2)).toBe(1);
  });

  it('walkScore handles a zero limit without dividing by zero', () => {
    expect(walkScore(0, 0)).toBe(1);
    expect(walkScore(0.1, 0)).toBe(0);
  });

  it('detourScore: 1 for no detour, falling to 0 at the owner limit', () => {
    expect(detourScore(0, 5)).toBe(1);
    expect(detourScore(2.5, 5)).toBe(0.5);
    expect(detourScore(5, 5)).toBe(0);
  });

  it('routeScore is the share of the journey spent riding with the match', () => {
    expect(routeScore(10, 0, 0)).toBe(1);
    expect(routeScore(8, 1, 1)).toBe(0.8);
    expect(routeScore(1, 1, 1)).toBeCloseTo(1 / 3, 10);
    expect(routeScore(0, 0, 0)).toBe(0);
  });

  it('timeScore: full marks near the deadline, falling to 0 at the earliest allowed arrival', () => {
    expect(timeScore(0)).toBe(1);
    expect(timeScore(MATCHING.IDEAL_EARLY_ARRIVAL_MIN)).toBe(1);
    expect(timeScore(MATCHING.MAX_EARLY_ARRIVAL_MIN)).toBe(0);
    const mid = (MATCHING.IDEAL_EARLY_ARRIVAL_MIN + MATCHING.MAX_EARLY_ARRIVAL_MIN) / 2;
    expect(timeScore(mid)).toBeCloseTo(0.5, 10);
  });

  it('budgetScore: cheaper is better, within budget stays at or above 0.5, over a fixed budget is 0', () => {
    expect(budgetScore(0, 500, false)).toBe(1);
    expect(budgetScore(250, 500, false)).toBe(0.75);
    expect(budgetScore(500, 500, false)).toBe(0.5);
    expect(budgetScore(600, 500, false)).toBe(0);
    expect(budgetScore(600, 500, true)).toBe(0.25);
  });
});

describe('combineScores', () => {
  const all = { route: 1, pickup: 1, time: 1, detour: 1, budget: 1, dropoff: 1 };

  it('is 100 when everything is perfect and 0 when everything is the worst', () => {
    expect(combineScores(all).score).toBe(100);
    expect(combineScores({ route: 0, pickup: 0, time: 0, detour: 0, budget: 0, dropoff: 0 }).score).toBe(0);
  });

  it('applies the weights', () => {
    // Only route is perfect: 30% of the total.
    expect(combineScores({ ...all, pickup: 0, time: 0, detour: 0, budget: 0, dropoff: 0 }).score).toBe(30);
    // Only pickup is perfect: 20%.
    expect(combineScores({ route: 0, pickup: 1, time: 0, detour: 0, budget: 0, dropoff: 0 }).score).toBe(20);
  });

  it('re-scales the weights when there is no budget, instead of treating it as zero', () => {
    const result = combineScores({ route: 1, pickup: 1, time: 1, detour: 1, dropoff: 1 });
    expect(result.score).toBe(100); // not 90
    expect(result.breakdown.map((c) => c.key)).not.toContain('budget');
    expect(result.breakdown.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 2);
  });

  it('re-scales when neither budget nor drop-off limit is given', () => {
    const result = combineScores({ route: 0.5, pickup: 0.5, time: 0.5, detour: 0.5 });
    expect(result.score).toBe(50);
    expect(result.breakdown).toHaveLength(4);
    // route 0.30 of 0.80
    expect(result.breakdown.find((c) => c.key === 'route')!.weight).toBeCloseTo(0.375, 3);
  });

  it('a missing component does not hurt a candidate relative to a perfect one', () => {
    const withBudget = combineScores({ ...all, budget: 1 }).score;
    const without = combineScores({ route: 1, pickup: 1, time: 1, detour: 1, dropoff: 1 }).score;
    expect(without).toBe(withBudget);
  });

  it('ranks a closer pickup above a farther one, all else equal', () => {
    const base = { route: 0.8, time: 1, detour: 0.8 };
    const near = combineScores({ ...base, pickup: walkScore(0.2, 2) }).score;
    const far = combineScores({ ...base, pickup: walkScore(1.8, 2) }).score;
    expect(near).toBeGreaterThan(far);
  });

  it('clamps out-of-range inputs and always stays within 0..100', () => {
    const r = combineScores({ route: 5, pickup: -3, time: 2, detour: 9 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.every((c) => c.value >= 0 && c.value <= 1)).toBe(true);
  });

  it('returns 0 when nothing applies', () => {
    expect(combineScores({})).toEqual({ score: 0, breakdown: [] });
  });

  it('takes custom weights', () => {
    const weights = { route: 1, pickup: 0, time: 0, detour: 0, budget: 0, dropoff: 0 };
    expect(combineScores({ route: 0.4, pickup: 1 }, weights).score).toBe(40);
  });
});

describe('luggage units', () => {
  it('counts each kind by its configured weight', () => {
    expect(luggageUnits({ large: 1, medium: 0, cabin: 0, backpack: 0, oversized: 0 })).toBe(2);
    expect(luggageUnits({ large: 1, medium: 2, cabin: 1, backpack: 2, oversized: 1 })).toBe(2 + 3 + 1 + 1 + 4);
    expect(luggageUnits(null)).toBe(0);
    expect(luggageUnits({})).toBe(0);
  });

  it('a suitcase takes more room than a backpack', () => {
    expect(luggageUnits({ large: 1 })).toBeGreaterThan(luggageUnits({ backpack: 1 }));
    // three cabin bags take less room than three large suitcases (PRD 5.3)
    expect(luggageUnits({ cabin: 3 })).toBeLessThan(luggageUnits({ large: 3 }));
  });

  it('uses the declared space for riders when the owner gave one', () => {
    expect(luggageUnitsAvailable({ declaredUnits: 5, vehicleCategory: 'SEDAN', ownLuggage: { large: 2 } })).toBe(5);
    expect(luggageUnitsAvailable({ declaredUnits: 0, vehicleCategory: 'SUV' })).toBe(0);
  });

  it('otherwise falls back to the vehicle default less the owner\'s own bags', () => {
    expect(luggageUnitsAvailable({ vehicleCategory: 'SEDAN', ownLuggage: { large: 1 } })).toBe(MATCHING.CATEGORY_LUGGAGE_UNITS.SEDAN - 2);
    expect(luggageUnitsAvailable({ vehicleCategory: 'HATCHBACK', ownLuggage: { oversized: 5 } })).toBe(0);
  });

  it('subtracts space already promised to riders, never below zero', () => {
    expect(luggageUnitsAvailable({ declaredUnits: 5, vehicleCategory: 'SEDAN', usedUnits: 3 })).toBe(2);
    expect(luggageUnitsAvailable({ declaredUnits: 5, vehicleCategory: 'SEDAN', usedUnits: 9 })).toBe(0);
  });
});
