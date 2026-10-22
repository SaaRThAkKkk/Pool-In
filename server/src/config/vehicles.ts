// Maximum passengers a category can carry, excluding the driver. These are conservative defaults used to
// stop an owner offering more seats than the vehicle can legally and physically hold. Owner-declared
// capacity verification (PRD section 5.2) comes with the saved-vehicles feature.
export const VEHICLE_CATEGORIES = {
  HATCHBACK: { label: 'Hatchback', maxPassengers: 4 },
  SEDAN: { label: 'Sedan', maxPassengers: 4 },
  SUV: { label: 'SUV', maxPassengers: 6 },
  MUV: { label: 'MUV / minivan', maxPassengers: 7 },
  OTHER: { label: 'Other', maxPassengers: 8 },
} as const;

export type VehicleCategory = keyof typeof VEHICLE_CATEGORIES;
export const VEHICLE_CATEGORY_KEYS = Object.keys(VEHICLE_CATEGORIES) as [VehicleCategory, ...VehicleCategory[]];
