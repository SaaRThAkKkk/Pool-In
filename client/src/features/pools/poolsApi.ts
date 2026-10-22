import { api } from '../../lib/api'

// Mirrors the server's vehicle categories (server/src/config/vehicles.ts). The server enforces the limits;
// these values only give instant feedback.
export const VEHICLE_CATEGORIES = [
  { value: 'HATCHBACK', label: 'Hatchback', maxPassengers: 4 },
  { value: 'SEDAN', label: 'Sedan', maxPassengers: 4 },
  { value: 'SUV', label: 'SUV', maxPassengers: 6 },
  { value: 'MUV', label: 'MUV / minivan', maxPassengers: 7 },
  { value: 'OTHER', label: 'Other', maxPassengers: 8 },
] as const

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number]['value']

export const categoryInfo = (value: string) => VEHICLE_CATEGORIES.find((c) => c.value === value)

export interface PlaceInput {
  label: string
  coordinates?: { lat: number; lng: number }
}

export interface CreatePoolPayload {
  origin: PlaceInput
  destination: PlaceInput
  /** Optional ISO-8601 departure. The create form no longer asks for one. */
  departureAt?: string
  vehicle: { category: VehicleCategory; make: string; model: string }
  seats: number
  askingPrice: number
  negotiable: boolean
}

export interface OwnerPool {
  id: string
  rideType: string
  origin: PlaceInput
  destination: PlaceInput
  /** null when the owner did not set a time. */
  departureAt: string | null
  vehicle: { category: VehicleCategory; make: string; model: string }
  seats: { offered: number; available: number; taken: number }
  pricing: { amount: number; currency: string; basis: string; negotiable: boolean }
  status: string
  createdAt: string
}

export const MY_POOLS_KEY = ['my-pools'] as const

export function createPool(payload: CreatePoolPayload) {
  return api<{ ride: OwnerPool }>('/rides', { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchMyPools() {
  return (await api<{ rides: OwnerPool[] }>('/rides/mine')).rides
}

export function formatFare(amount: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}
