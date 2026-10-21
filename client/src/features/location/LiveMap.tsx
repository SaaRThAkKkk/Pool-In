import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPosition } from './useLiveLocation'

// Roughly the middle of India, shown until we have a position.
const DEFAULT_CENTER: [number, number] = [22.5, 79]
const DEFAULT_ZOOM = 5
const USER_ZOOM = 15

// Pulsing dot; the animation lives in index.css (.user-dot-*).
const userIcon = L.divIcon({
  className: 'user-dot',
  html: '<span class="user-dot-pulse"></span><span class="user-dot-core"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
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
      {position && (
        <>
          <Circle
            center={[position.lat, position.lng]}
            radius={position.accuracy}
            pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.12 }}
          />
          <Marker position={[position.lat, position.lng]} icon={userIcon} interactive={false} keyboard={false} />
        </>
      )}
      <Follow position={position} recenterSignal={recenterSignal} />
    </MapContainer>
  )
}
