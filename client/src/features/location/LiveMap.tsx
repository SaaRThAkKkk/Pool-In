import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPosition } from './useLiveLocation'

// Roughly the middle of India, shown until we have a position.
const DEFAULT_CENTER: [number, number] = [22.5, 79]
const DEFAULT_ZOOM = 5
const USER_ZOOM = 15

// "You are here": a dot with two rings rippling out of it. The styling and animation live in index.css
// (.user-dot-*). The marker box is as large as the rings ever get, so nothing is stretched and it stays sharp.
const userIcon = L.divIcon({
  className: 'user-dot',
  html: '<span class="user-dot-ring"></span><span class="user-dot-ring"></span><span class="user-dot-halo"></span><span class="user-dot-core"></span>',
  iconSize: [56, 56],
  iconAnchor: [28, 28],
})

// Moves the map to the user on the first fix, and again whenever `recenterSignal` changes.
// Later position updates only move the marker, so the map never fights a user who is panning around.
function Follow({ position, recenterSignal }: { position: GeoPosition | null; recenterSignal: number }) {
  const map = useMap()
  const centered = useRef(false)
  const lastSignal = useRef(recenterSignal)

  useEffect(() => {
    if (!position) return
    const wantsRecenter = lastSignal.current !== recenterSignal
    if (!centered.current || wantsRecenter) {
      centered.current = true
      lastSignal.current = recenterSignal
      map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), USER_ZOOM), { duration: 1.8 })
    }
  }, [map, position, recenterSignal])

  return null
}

export function LiveMap({ position, recenterSignal = 0 }: { position: GeoPosition | null; recenterSignal?: number }) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom={false} // the map sits in a page that scrolls
      className="h-full w-full"
      aria-label="Map showing your current location"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* Only the dot is drawn. A circle for how precise the fix is would cover the whole view in blue when zoomed
          in (on a laptop it can be a kilometre wide); the precision is given in words beside the map instead. */}
      {position && <Marker position={[position.lat, position.lng]} icon={userIcon} interactive={false} keyboard={false} />}
      <Follow position={position} recenterSignal={recenterSignal} />
    </MapContainer>
  )
}
