import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { WheelZoom } from '../maps/WheelZoom'
import { fadeJump } from './mapMotion'
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

// At this zoom or closer, the map is already near the user.
const NEAR_ZOOM = 12

// Moves the map to the user on the first fix, and again whenever `recenterSignal` changes.
// Later position updates only move the marker, so the map never fights a user who is panning around.
function Follow({ position, recenterSignal }: { position: GeoPosition | null; recenterSignal: number }) {
  const map = useMap()
  const centered = useRef(false)
  const lastSignal = useRef(recenterSignal)
  const cancelJump = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!position) return
    const wantsRecenter = lastSignal.current !== recenterSignal
    if (!centered.current || wantsRecenter) {
      centered.current = true
      lastSignal.current = recenterSignal
      const target: [number, number] = [position.lat, position.lng]
      const zoom = Math.max(map.getZoom(), USER_ZOOM)

      // Already zoomed in near the user: a short glide looks fine, because the map tiles stay sharp.
      if (map.getZoom() >= NEAR_ZOOM) {
        map.flyTo(target, zoom, { duration: 0.8 })
        return
      }
      // From the country view, flying in stretches low-detail tiles and the map looks blurred for a couple of
      // seconds. Instead: fade the map out, jump straight there, and fade back in once the sharp tiles have loaded.
      cancelJump.current?.()
      cancelJump.current = fadeJump(map, target, zoom)
    }
  }, [map, position, recenterSignal])

  // A jump must finish even while new positions keep arriving, so it is only cancelled when the map goes away.
  useEffect(() => () => cancelJump.current?.(), [])

  return null
}

export function LiveMap({ position, recenterSignal = 0 }: { position: GeoPosition | null; recenterSignal?: number }) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom={false} // the map sits in a page that scrolls; <WheelZoom> turns it on after a click
      className="live-map h-full w-full"
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
      <WheelZoom />
    </MapContainer>
  )
}
