import { MATCHING } from '../../config/matching.js';
import type { Luggage } from '../../models/poolParts.js';

// Luggage in "standard bag" units, using the configured weight of each kind. An approximation, not a guarantee
// that bags physically fit (that needs measured volumes, which are not collected yet).
export function luggageUnits(l: Partial<Luggage> | null | undefined): number {
  if (!l) return 0;
  const w = MATCHING.LUGGAGE_UNITS;
  return (l.large ?? 0) * w.large + (l.medium ?? 0) * w.medium + (l.cabin ?? 0) * w.cabin + (l.backpack ?? 0) * w.backpack + (l.oversized ?? 0) * w.oversized;
}

export interface OwnerLuggageInfo {
  /** Space for riders' luggage the owner declared, in standard-bag units. */
  declaredUnits?: number | null;
  vehicleCategory: keyof typeof MATCHING.CATEGORY_LUGGAGE_UNITS;
  /** The owner's own luggage, which takes space too when nothing was declared. */
  ownLuggage?: Partial<Luggage> | null;
  /** Units already promised to riders who have joined. */
  usedUnits?: number | null;
}

// How many luggage units a new rider can still bring. A declared figure is taken as space for riders;
// otherwise a default for the vehicle type is used, less the owner's own bags.
export function luggageUnitsAvailable(o: OwnerLuggageInfo): number {
  const total =
    typeof o.declaredUnits === 'number'
      ? o.declaredUnits
      : Math.max(0, MATCHING.CATEGORY_LUGGAGE_UNITS[o.vehicleCategory] - luggageUnits(o.ownLuggage));
  return Math.max(0, total - (o.usedUnits ?? 0));
}
