import { useState } from 'react'
import { Link } from 'react-router-dom'
import { JoinPoolPanel } from '../pools/JoinPoolPanel'
import { useMe } from '../auth/useMe'
import { LiveMap } from './LiveMap'
import { LocationStatus } from './LocationStatus'
import { useLiveLocation } from './useLiveLocation'

// Home hero: the live map is the background, with an overlay card on top.
export function HomeHero() {
  const me = useMe()
  const { position, status, retry } = useLiveLocation()
  const [panelOpen, setPanelOpen] = useState(false)
  const [recenterSignal, setRecenterSignal] = useState(0)

  const signedIn = Boolean(me.data)
  const cta = 'rounded-md px-5 py-3 font-medium'

  return (
    <section
      aria-label="Start a pool"
      className="relative isolate h-[36rem] overflow-hidden rounded-xl border border-slate-200 bg-slate-200"
    >
      <div className="absolute inset-0 z-0">
        <LiveMap position={position} recenterSignal={recenterSignal} />
      </div>

      {/* Wrapper ignores the pointer so the map stays draggable around the card. */}
      <div className="pointer-events-none relative z-[1000] flex h-full items-start p-4 sm:items-center sm:p-8">
        <div className="pointer-events-auto w-full max-w-md space-y-4 rounded-xl bg-white/95 p-5 shadow-lg backdrop-blur">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Share the ride. Split the cost.</h1>
            <p className="mt-2 text-slate-600">
              Pool-In connects people travelling along similar routes so they can coordinate a shared journey.
            </p>
          </div>

          <LocationStatus
            status={status}
            position={position}
            onRetry={retry}
            onRecenter={() => setRecenterSignal((n) => n + 1)}
          />

          {panelOpen && signedIn ? (
            <JoinPoolPanel position={position} onClose={() => setPanelOpen(false)} />
          ) : (
            <div className="flex flex-wrap gap-3">
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => setPanelOpen(true)}
                  className={`${cta} bg-brand-600 text-white hover:bg-brand-700`}
                >
                  Join a pool
                </button>
              ) : (
                <Link
                  to="/login"
                  state={{ from: '/' }}
                  className={`${cta} bg-brand-600 text-white hover:bg-brand-700`}
                >
                  Join a pool
                </Link>
              )}
              <Link to="/how-it-works" className={`${cta} border border-slate-300 bg-white hover:bg-slate-100`}>
                How it works
              </Link>
            </div>
          )}
          {!signedIn && !me.isPending && (
            <p className="text-xs text-slate-500">You'll be asked to log in first.</p>
          )}
        </div>
      </div>
    </section>
  )
}
