import { useCallback, useEffect, useState } from 'react'

export interface GeoPosition {
  lat: number
  lng: number
  /** Radius in metres within which the real position is likely to be. */
  accuracy: number
  timestamp: number
}

export type LocationStatus =
  | 'locating' // waiting for the first fix or for the user to answer the browser prompt
  | 'active' // we have a position
  | 'denied' // the user (or the browser) refused permission
  | 'unavailable' // no geolocation support
  | 'error' // position could not be determined right now

const supported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator

// Follows the user's position while the component using it is mounted, and stops when it unmounts.
// The position stays in the browser: nothing here is sent to the server.
export function useLiveLocation() {
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [status, setStatus] = useState<LocationStatus>(() => (supported() ? 'locating' : 'unavailable'))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!supported()) return

    // Keep our own reference so cleanup stops the same watch even if the global changes.
    const geo = navigator.geolocation
    const id = geo.watchPosition(
      (p) => {
        setPosition({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        })
        setStatus('active')
      },
      (err) => {
        // 1 = PERMISSION_DENIED. Anything else (unavailable, timeout) can recover, and the watch keeps going.
        setStatus(err.code === 1 ? 'denied' : 'error')
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
    return () => geo.clearWatch(id)
  }, [attempt])

  // Ask again, e.g. after the user changed the site permission.
  const retry = useCallback(() => {
    setStatus('locating')
    setAttempt((n) => n + 1)
  }, [])

  return { position, status, retry }
}
