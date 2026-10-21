import { useEffect, useRef } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPosition } from './useLiveLocation'

// Roughly the middle of India, shown until we have a position.
const DEFAULT_CENTER: [number, number] = [22.5, 79]
const DEFAULT_ZOOM = 5
const USER_ZOOM = 15

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
      map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), USER_ZOOM))
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
          <CircleMarker
            center={[position.lat, position.lng]}
            radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        </>
      )}
      <Follow position={position} recenterSignal={recenterSignal} />
    </MapContainer>
  )
}
