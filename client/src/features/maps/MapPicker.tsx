import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useMutation } from '@tanstack/react-query'
import { LoaderCircle, MapPin, X } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { reversePlace, type LatLng, type Place } from './mapsApi'

const INDIA_CENTER: [number, number] = [22.5, 79]
const pin = L.divIcon({
  className: 'route-pin-wrap',
  html: '<span class="route-pin route-pin-start"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function Taps({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

// The map is created while the dialog is still animating in; tell Leaflet its real size once it has settled.
function FixSize() {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 50)
    return () => clearTimeout(t)
  }, [map])
  return null
}

interface Props {
  title: string
  /** Where the map opens: the user's position, or the pin they chose before. */
  center?: LatLng | null
  onConfirm: (place: Place) => void
  onClose: () => void
}

// A full-screen map: tap to drop a pin, then confirm. The place name is looked up on our server.
export function MapPicker({ title, center, onConfirm, onClose }: Props) {
  const [picked, setPicked] = useState<LatLng | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const lookup = useMutation({
    mutationFn: (p: LatLng) => reversePlace(p),
    onSuccess: onConfirm,
  })

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const error =
    lookup.error instanceof ApiError ? lookup.error.message : lookup.isError ? 'Could not reach the server. Please try again.' : null

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[2000] flex flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <p className="text-sm text-slate-600">Tap the map to drop a pin. Drag to move around, pinch or use + / − to zoom.</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close map"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
        >
          <X aria-hidden className="h-6 w-6" />
        </button>
      </div>

      <div className="isolate min-h-0 flex-1">
        <MapContainer
          center={picked ? [picked.lat, picked.lng] : center ? [center.lat, center.lng] : INDIA_CENTER}
          zoom={center ? 15 : 5}
          className="h-full w-full"
          aria-label="Map to choose a place"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Taps onPick={setPicked} />
          <FixSize />
          {picked && <Marker position={[picked.lat, picked.lng]} icon={pin} interactive={false} keyboard={false} />}
        </MapContainer>
      </div>

      <div className="space-y-2 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 !py-3">
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked || lookup.isPending}
            onClick={() => picked && lookup.mutate(picked)}
            className="btn-primary flex-1 !py-3"
          >
            {lookup.isPending ? (
              <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" />
            ) : (
              <MapPin aria-hidden className="h-5 w-5" />
            )}
            {picked ? 'Use this location' : 'Tap the map first'}
          </button>
        </div>
      </div>
    </div>
  )
}
