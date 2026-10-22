import { api } from '../../lib/api'

export interface LatLng {
  lat: number
  lng: number
}

export interface Place extends LatLng {
  id: string
  title: string
  subtitle: string
  /** Full text stored on a pool. */
  label: string
}

export interface RouteInfo {
  distanceMeters: number
  durationSeconds: number
  /** [lat, lng] pairs ready to draw. */
  path: [number, number][]
}

export async function searchPlaces(query: string, bias?: LatLng | null) {
  const params = new URLSearchParams({ q: query })
  if (bias) {
    params.set('lat', String(bias.lat))
    params.set('lng', String(bias.lng))
  }
  return (await api<{ places: Place[] }>(`/maps/places?${params}`)).places
}

export async function fetchRoute(from: LatLng, to: LatLng) {
  const params = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  })
  return (await api<{ route: RouteInfo }>(`/maps/route?${params}`)).route
}

export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
