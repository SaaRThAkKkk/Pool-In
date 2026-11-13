import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { TRANSITION_MS, stopFor } from './routeStops'

// Shown for a moment each time the page changes: a little car drives along a road under the header to that
// page's stop, which pops when it arrives. Decoration only: it never blocks clicks, and it is hidden from
// screen readers and for people who have asked for reduced motion (see .route-transition in index.css).
export function RouteTransition() {
  const { pathname } = useLocation()
  const [seen, setSeen] = useState(pathname)
  const [driving, setDriving] = useState<string | null>(null)

  // A new page: start a drive. (Not on the very first page, where nothing has "changed".)
  if (pathname !== seen) {
    setSeen(pathname)
    setDriving(pathname)
  }

  useEffect(() => {
    if (!driving) return
    const done = setTimeout(() => setDriving(null), TRANSITION_MS)
    return () => clearTimeout(done)
  }, [driving])

  if (!driving) return null
  const stop = stopFor(driving)
  const Icon = stop.icon

  return (
    <div key={driving} aria-hidden data-testid="route-transition" className="route-transition">
      <span className="route-transition-road" />
      <span className="route-transition-car">
        <svg viewBox="-20 -11 40 22" width="40" height="22">
          <rect x="-17" y="-9" width="34" height="18" rx="7" fill="#4f46e5" />
          <rect x="-6" y="-6" width="14" height="12" rx="3" fill="#c7d2fe" />
          <circle cx="14" cy="-5" r="2" fill="#fde68a" />
          <circle cx="14" cy="5" r="2" fill="#fde68a" />
        </svg>
      </span>
      <span className={`route-transition-stop bg-linear-to-br ${stop.tone}`}>
        <Icon className="h-3.5 w-3.5" />
        {stop.label}
      </span>
    </div>
  )
}
