import { api } from '../../lib/api'
import type { LatLng } from '../maps/mapsApi'

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

export const MAX_PEOPLE = 6
export const MAX_LUGGAGE_PER_TYPE = 10

export const LUGGAGE_TYPES = [
  { key: 'large', label: 'Large suitcases', hint: 'Check-in size' },
  { key: 'medium', label: 'Medium suitcases', hint: 'Mid-size bags' },
  { key: 'cabin', label: 'Cabin bags', hint: 'Carry-on size' },
  { key: 'backpack', label: 'Backpacks & small bags', hint: 'Fits on your lap' },
  { key: 'oversized', label: 'Oversized items', hint: 'Bikes, instruments, boxes' },
] as const
export type LuggageKey = (typeof LUGGAGE_TYPES)[number]['key']
export type Luggage = Record<LuggageKey, number>

export const EMPTY_LUGGAGE: Luggage = { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 }

export interface PlaceInput {
  label: string
  coordinates?: LatLng
}

interface PoolInCommon {
  origin: PlaceInput
  destination: PlaceInput
  /** ISO-8601: when the user needs to reach the destination. */
  arriveBy: string
  luggage: Luggage
}

export interface OwnVehiclePayload extends PoolInCommon {
  mode: 'OWN_VEHICLE'
  vehicle: { category: VehicleCategory; make: string; model: string }
  seats: number
  askingPrice: number
  negotiable: boolean
}

export interface PoolCabPayload extends PoolInCommon {
  mode: 'POOL_CAB'
  people: number
}

export type PoolInPayload = OwnVehiclePayload | PoolCabPayload
export type PoolMode = PoolInPayload['mode']

interface PoolBase {
  id: string
  origin: PlaceInput
  destination: PlaceInput
  /** null for pools saved before arrival times existed. */
  arriveBy: string | null
  luggage: Luggage
  status: string
  createdAt: string
}

export interface CarOwnerPool extends PoolBase {
  section: 'CAR_OWNER'
  vehicle: { category: VehicleCategory; make: string; model: string }
  seats: { offered: number; available: number; taken: number }
  pricing: { amount: number; currency: string; basis: string; negotiable: boolean }
}

export interface CabPool extends PoolBase {
  section: 'CAB'
  people: number
}

export type Pool = CarOwnerPool | CabPool

export interface MatchingInfo {
  /** NOT_AVAILABLE means matching is not built yet, so nothing was actually searched. */
  status: 'NOT_AVAILABLE' | 'SEARCHED'
  sections: ('CAR_OWNER' | 'CAB')[]
  matches: { id: string; section: 'CAR_OWNER' | 'CAB' }[]
}

export type PoolInResult =
  | { outcome: 'POOL_CREATED'; section: 'CAR_OWNER'; pool: CarOwnerPool }
  | { outcome: 'REQUEST_CREATED'; section: 'CAB'; pool: CabPool; matching: MatchingInfo }
  | { outcome: 'MATCHES_FOUND'; matching: MatchingInfo }

export const MY_POOLS_KEY = ['my-pools'] as const

export function poolIn(payload: PoolInPayload) {
  return api<PoolInResult>('/pools', { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchMyPools() {
  return (await api<{ pools: Pool[] }>('/pools/mine')).pools
}

export function formatFare(amount: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function describeLuggage(l: Luggage): string {
  const parts = LUGGAGE_TYPES.filter((t) => l[t.key] > 0).map((t) => `${l[t.key]} ${t.label.toLowerCase()}`)
  return parts.length ? parts.join(', ') : 'No luggage'
}
