import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
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
  const joinContent = (
    <>
      Join a pool
      <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
    </>
  )

  return (
    <section
      aria-label="Start a pool"
      className="relative isolate h-[36rem] overflow-hidden rounded-2xl border border-white/60 bg-slate-200 shadow-xl shadow-brand-500/10"
    >
      <div className="absolute inset-0 z-0 animate-fade-in">
        <LiveMap position={position} recenterSignal={recenterSignal} />
      </div>
      {/* Soft wash so the card reads clearly on busy map areas. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[500] bg-linear-to-r from-slate-900/25 via-transparent to-transparent" />

      {/* Wrapper ignores the pointer so the map stays draggable around the card. */}
      <div className="pointer-events-none relative z-[1000] flex h-full items-start p-4 sm:items-center sm:p-8">
        <div className="pointer-events-auto w-full max-w-md animate-fade-up space-y-4 rounded-2xl bg-white/90 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-md sm:p-6">
          <div className="animate-fade-up" style={{ animationDelay: '100ms' }}>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Share the ride.{' '}
              <span className="bg-linear-to-r from-brand-600 to-indigo-500 bg-clip-text text-transparent">
                Split the cost.
              </span>
            </h1>
            <p className="mt-2 text-slate-600">
              Pool-In connects people travelling along similar routes so they can coordinate a shared journey.
            </p>
          </div>

          <div className="animate-fade-up" style={{ animationDelay: '200ms' }}>
            <LocationStatus
              status={status}
              position={position}
              onRetry={retry}
              onRecenter={() => setRecenterSignal((n) => n + 1)}
            />
          </div>

          {panelOpen && signedIn ? (
            <div className="animate-pop-in">
              <JoinPoolPanel position={position} onClose={() => setPanelOpen(false)} />
            </div>
          ) : (
            <div className="animate-fade-up space-y-2" style={{ animationDelay: '300ms' }}>
              <div className="flex flex-wrap gap-3">
                {signedIn ? (
                  <button type="button" onClick={() => setPanelOpen(true)} className="btn-primary group">
                    {joinContent}
                  </button>
                ) : (
                  <Link to="/login" state={{ from: '/' }} className="btn-primary group">
                    {joinContent}
                  </Link>
                )}
                <Link to="/how-it-works" className="btn-secondary">
                  How it works
                </Link>
              </div>
              {!signedIn && !me.isPending && <p className="text-xs text-slate-500">You'll be asked to log in first.</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
