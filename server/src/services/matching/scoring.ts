import { MATCHING, type ScoreKey } from '../../config/matching.js';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, digits: number) => Number(n.toFixed(digits));

// Each component is scored from 0 (worst) to 1 (best), only for candidates that already passed every hard rule.

/** How much of the passenger's whole journey is spent riding with the match (not walking/travelling to and from it). */
export function routeScore(rideKm: number, pickupKm: number, dropoffKm: number): number {
  const total = rideKm + pickupKm + dropoffKm;
  return total <= 0 ? 0 : clamp01(rideKm / total);
}

/** 1 at the pickup point itself, falling to 0 at the passenger's limit. Also used for the drop-off. */
export function walkScore(km: number, maxKm: number): number {
  return maxKm <= 0 ? (km <= 0 ? 1 : 0) : clamp01(1 - km / maxKm);
}

/** 1 when the driver does not leave the route, falling to 0 at the owner's limit. */
export function detourScore(detourKm: number, maxKm: number): number {
  return walkScore(detourKm, maxKm);
}

/** Arriving a little before the deadline is ideal; arriving much earlier scores lower. */
export function timeScore(earlyMinutes: number): number {
  const ideal = MATCHING.IDEAL_EARLY_ARRIVAL_MIN;
  const max = MATCHING.MAX_EARLY_ARRIVAL_MIN;
  if (earlyMinutes <= ideal) return 1;
  return clamp01(1 - (earlyMinutes - ideal) / (max - ideal));
}

/** A cheaper fare scores higher (never below 0.5 while within budget). A negotiable fare above budget scores low but is kept. */
export function budgetScore(price: number, budget: number, negotiable: boolean): number {
  if (price <= budget) return budget <= 0 ? 1 : 0.5 + 0.5 * clamp01(1 - price / budget);
  return negotiable ? 0.25 : 0;
}

export interface ScoreComponent {
  key: ScoreKey;
  /** 0 to 1. */
  value: number;
  /** Share of the total after dropping components that do not apply. */
  weight: number;
}

// Weighted sum, 0 to 100. Components that do not apply (no budget, no drop-off limit) are left out and the
// remaining weights are re-scaled to total 1, so a missing value is never treated as zero.
export function combineScores(
  components: Partial<Record<ScoreKey, number>>,
  weights: Record<ScoreKey, number> = MATCHING.WEIGHTS,
): { score: number; breakdown: ScoreComponent[] } {
  const keys = (Object.keys(weights) as ScoreKey[]).filter((k) => components[k] !== undefined);
  const total = keys.reduce((sum, k) => sum + weights[k], 0);
  if (total <= 0) return { score: 0, breakdown: [] };

  const breakdown = keys.map((key) => ({
    key,
    value: round(clamp01(components[key]!), 3),
    weight: round(weights[key] / total, 3),
  }));
  const score = keys.reduce((sum, k) => sum + (weights[k] / total) * clamp01(components[k]!), 0) * 100;
  return { score: round(score, 1), breakdown };
}
