import { LocateFixed, LocateOff } from 'lucide-react'
import type { GeoPosition, LocationStatus as Status } from './useLiveLocation'

interface Props {
  status: Status
  position: GeoPosition | null
  onRetry: () => void
  onRecenter: () => void
}

export function LocationStatus({ status, position, onRetry, onRecenter }: Props) {
  const button = 'ml-2 text-xs font-medium text-brand-700 underline'

  return (
    <div role="status" className="text-sm text-slate-700">
      {status === 'locating' && !position && <p>Finding your location… allow access in your browser to start from where you are.</p>}

      {position && (
        <p className="flex flex-wrap items-center gap-1">
          <LocateFixed aria-hidden className="h-4 w-4 text-brand-600" />
          Using your current location (within about {Math.round(position.accuracy)} m)
          <button type="button" onClick={onRecenter} className={button}>
            Re-centre map
          </button>
        </p>
      )}

      {status === 'error' && (
        <p>{position ? 'Having trouble updating your location. Showing the last known position.' : "Couldn't get a location fix right now. Still trying…"}</p>
      )}

      {status === 'denied' && (
        <p className="flex flex-wrap items-center gap-1">
          <LocateOff aria-hidden className="h-4 w-4 text-amber-600" />
          Location access is blocked. Allow it in your browser's site settings to start from where you are.
          <button type="button" onClick={onRetry} className={button}>
            Try again
          </button>
        </p>
      )}

      {status === 'unavailable' && <p>Your browser doesn't support location. You'll enter your start point by hand.</p>}

      <p className="mt-1 text-xs text-slate-500">
        Your location stays in your browser. It is not sent to Pool-In unless you choose to share it in a pool.
      </p>
    </div>
  )
}
