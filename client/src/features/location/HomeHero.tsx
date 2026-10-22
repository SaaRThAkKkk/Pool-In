import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LiveMap } from './LiveMap'
import { LocationStatus } from './LocationStatus'
import { useLiveLocation } from './useLiveLocation'

// Home hero: the live map is the background, with an overlay card on top and one big Pool In button.
export function HomeHero() {
  const { position, status, retry } = useLiveLocation()
  const [recenterSignal, setRecenterSignal] = useState(0)

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
        <div className="pointer-events-auto w-full max-w-md animate-fade-up space-y-5 rounded-2xl bg-white/90 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-md sm:p-6">
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

          {/* The one way in. The route guard sends signed-out visitors to log in and then back to /pool-in. */}
          <div className="animate-fade-up flex flex-col items-center gap-2 pt-1" style={{ animationDelay: '300ms' }}>
            <Link
              to="/pool-in"
              className="group relative inline-flex items-center gap-3 rounded-full bg-linear-to-r from-brand-600 to-indigo-600 py-2.5 pl-2.5 pr-8 text-xl font-extrabold text-white shadow-xl shadow-brand-500/35 transition duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-2xl hover:shadow-brand-500/45 active:translate-y-0 active:scale-95"
            >
              {/* Soft pulsing ring that draws the eye to the button. */}
              <span aria-hidden className="absolute inset-0 -z-10 animate-ping rounded-full bg-brand-500/40 [animation-duration:2.4s]" />
              <img
                src="/favicon-192.png"
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover ring-2 ring-white/70 transition duration-300 group-hover:rotate-12"
              />
              Pool In
            </Link>
            <p className="text-xs text-slate-500">
              Offer seats or share a cab.{' '}
              <Link to="/how-it-works" className="underline underline-offset-2 hover:text-slate-700">
                How it works
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
