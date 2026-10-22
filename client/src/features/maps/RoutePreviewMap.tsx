import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from './mapsApi'

const DEFAULT_CENTER: [number, number] = [22.5, 79]

const pin = (kind: 'start' | 'end') =>
  L.divIcon({
    className: 'route-pin-wrap',
    html: `<span class="route-pin route-pin-${kind}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
const startIcon = pin('start')
const endIcon = pin('end')

// Keeps the view on whatever the user has chosen so far: the whole route, or just the start.
function FitView({ start, end, path }: { start: LatLng | null; end: LatLng | null; path: [number, number][] | null }) {
  const map = useMap()
  useEffect(() => {
    const points: [number, number][] =
      path && path.length > 1
        ? path
        : [start, end].filter((p): p is LatLng => p !== null).map((p) => [p.lat, p.lng] as [number, number])
    if (points.length === 0) return
    if (points.length === 1) {
      map.flyTo(points[0]!, Math.max(map.getZoom(), 14), { duration: 1 })
    } else {
      map.flyToBounds(L.latLngBounds(points), { padding: [48, 48], duration: 1.2 })
    }
  }, [map, start, end, path])
  return null
}

interface Props {
  start: LatLng | null
  end: LatLng | null
  /** [lat, lng] pairs of the driving route, once calculated. */
  path: [number, number][] | null
}

export function RoutePreviewMap({ start, end, path }: Props) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={5}
      scrollWheelZoom={false}
      className="h-full w-full"
      aria-label="Map showing your route"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {path && path.length > 1 && (
        <>
          {/* Soft wide glow under the pulsing line. */}
          <Polyline positions={path} pathOptions={{ color: '#2563eb', weight: 12, opacity: 0.18, className: 'route-glow' }} />
          <Polyline positions={path} pathOptions={{ color: '#2563eb', weight: 5, lineCap: 'round', lineJoin: 'round', className: 'route-line' }} />
        </>
      )}
      {start && <Marker position={[start.lat, start.lng]} icon={startIcon} interactive={false} keyboard={false} />}
      {end && <Marker position={[end.lat, end.lng]} icon={endIcon} interactive={false} keyboard={false} />}
      <FitView start={start} end={end} path={path} />
    </MapContainer>
  )
}
