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
  /** Most extra distance the owner will drive for a rider. Left out: the server uses a default. */
  maxDriverDetourKm?: number
  /** Room for riders' luggage, in standard bags. Left out: a default for the vehicle type is used. */
  luggageSpaceUnits?: number
}

export interface PoolCabPayload extends PoolInCommon {
  mode: 'POOL_CAB'
  people: number
  /** Most the passenger will travel to be picked up. Left out: the server uses a default. */
  maxPickupTravelKm?: number
  /** Optional: most they will travel from the drop-off point to their destination. */
  maxDropoffTravelKm?: number
  /** Optional: most they want to pay per person. */
  maxBudget?: number
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
  maxDriverDetourKm?: number | null
  luggageSpaceUnits?: number | null
  /** False when no route is stored, so passengers cannot be matched with this pool yet. */
  matchable?: boolean
}

export interface CabPool extends PoolBase {
  section: 'CAB'
  people: number
  maxPickupTravelKm?: number | null
  maxDropoffTravelKm?: number | null
  maxBudget?: number | null
  searchExpiresAt?: string | null
}

export type Pool = CarOwnerPool | CabPool

export interface ScoreComponent {
  key: 'route' | 'pickup' | 'time' | 'detour' | 'budget' | 'dropoff'
  value: number
  weight: number
}

// A car-owner pool that fits the passenger, found by the matching algorithm.
export interface OwnerMatch {
  section: 'CAR_OWNER'
  poolId: string
  /** 0 to 100. */
  score: number
  breakdown: ScoreComponent[]
  reasons: string[]
  route: { from: string; to: string }
  vehicle: { category: string; make: string; model: string }
  seatsAvailable: number
  fare: { amount: number; negotiable: boolean }
  pickup: { lat: number; lng: number; roadKmFromRequestedPickup: number; eta: string }
  dropoff: { lat: number; lng: number; roadKmToDestination: number; eta: string }
  driverDetourKm: number
  rideKm: number
  driverDepartsAt: string
}

// A proposed group of passengers sharing a cab. NOT a confirmed ride: no driver or vehicle yet.
export interface PassengerMatch {
  section: 'CAB'
  requestId: string
  score: number
  breakdown: ScoreComponent[]
  reasons: string[]
  otherPeople: number
  groupSize: number
  pickup: { lat: number; lng: number; roadKmForYou: number }
  dropoff: { lat: number; lng: number; roadKmForYou: number }
  rideKm: number
  rideMinutes: number
  note: string
}

export interface OwnerSearchInfo {
  /** DEGRADED: routing trouble meant some pools could not be checked, so the list may be incomplete. */
  status: 'OK' | 'DEGRADED' | 'NEEDS_COORDINATES'
  sections?: ('CAR_OWNER' | 'CAB')[]
  matches: OwnerMatch[]
}

export type PoolInResult =
  | { outcome: 'POOL_CREATED'; section: 'CAR_OWNER'; pool: CarOwnerPool }
  | { outcome: 'SEARCH_STARTED'; section: 'CAB'; pool: CabPool; windowSeconds: number; matching: OwnerSearchInfo }
  | { outcome: 'REQUEST_CREATED'; section: 'CAB'; pool: CabPool; matching: OwnerSearchInfo }
  | { outcome: 'MATCHES_FOUND'; matching: OwnerSearchInfo }

export interface SearchState {
  id: string
  status: 'SEARCHING' | 'SEARCH_TIMED_OUT' | 'OPEN' | 'CANCELLED' | string
  windowSeconds: number
  expiresAt: string | null
  remainingSeconds: number
  matches: OwnerMatch[]
  matching: { status: 'OK' | 'DEGRADED' }
  /** True once the five minutes are over and the user can ask to be matched with other passengers. */
  canCreatePoolingRequest: boolean
}

export interface PassengerGroups {
  status: 'OK' | 'DEGRADED' | 'NEEDS_COORDINATES'
  matches: PassengerMatch[]
}

export const MY_POOLS_KEY = ['my-pools'] as const
export const searchKey = (id: string) => ['search', id] as const

export function poolIn(payload: PoolInPayload) {
  return api<PoolInResult>('/pools', { method: 'POST', body: JSON.stringify(payload) })
}

export async function fetchMyPools() {
  return (await api<{ pools: Pool[] }>('/pools/mine')).pools
}

export async function fetchSearch(id: string) {
  return (await api<{ search: SearchState }>(`/pools/${id}/search`)).search
}

export async function fetchPassengerMatches(id: string) {
  return (await api<{ groups: PassengerGroups }>(`/pools/${id}/passenger-matches`)).groups
}

export function cancelSearch(id: string) {
  return api<Record<string, never>>(`/pools/${id}/cancel-search`, { method: 'POST' })
}

// After the search window ends: ask to be matched with other passengers instead.
export function createPoolingRequest(id: string) {
  return api<{ pool: CabPool; groups: PassengerGroups }>(`/pools/${id}/pooling-request`, { method: 'POST' })
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
