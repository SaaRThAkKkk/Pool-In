import { Luggage, MapPinned, MessagesSquare, Route, ShieldCheck, Users } from 'lucide-react'
import { Reveal } from '../components/Reveal'
import { ApiStatus } from '../features/health/ApiStatus'
import { HomeHero } from '../features/location/HomeHero'

const features = [
  { icon: Route, title: 'Route-aware matching', text: 'Find people whose journey really overlaps yours, not just the same destination name.' },
  { icon: Luggage, title: 'Luggage-aware', text: 'We check that passengers and bags fit in the vehicle before suggesting a ride.' },
  { icon: Users, title: 'Pool Rooms', text: 'Once everyone agrees, chat and plan pickups together in a private room.' },
  { icon: ShieldCheck, title: 'Consent first', text: 'Women-only pools and live location sharing are opt-in and enforced by the server.' },
]

// The same curve the car follows in index.css (.journey-car).
const ROAD = 'M 20 40 C 180 -10, 320 90, 500 40 S 820 -10, 980 40'

const journey = [
  { icon: MapPinned, title: 'Tell us your trip', text: 'Where from, where to, and when you need to arrive.' },
  { icon: Route, title: 'We match your route', text: 'Pools and travellers whose journey really fits yours.' },
  { icon: MessagesSquare, title: 'Chat and share', text: 'Message your match and agree where to meet.' },
]

export function LandingPage() {
  return (
    <div className="space-y-12">
      <HomeHero />

      <Reveal>
        <section aria-label="How a pool comes together" className="rounded-2xl border border-slate-200 bg-white/80 p-5 backdrop-blur sm:p-8">
          <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">From your door to your destination, together</h2>
          {/* Decoration: a road that draws itself, with a car travelling from the first stop to the last. */}
          <svg aria-hidden viewBox="0 0 1000 80" className="mt-5 w-full">
            <path d={ROAD} fill="none" stroke="#dbeafe" strokeWidth="10" strokeLinecap="round" />
            <path d={ROAD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" className="journey-road" />
            {[20, 500, 980].map((x, i) => (
              <g key={x} className="journey-stop" style={{ animationDelay: `${i * 4.2}s` }}>
                <circle cx={x} cy="40" r="11" fill="#ffffff" stroke="#1d4ed8" strokeWidth="4" />
                <circle cx={x} cy="40" r="4" fill="#1d4ed8" />
              </g>
            ))}
            <g className="journey-car">
              <rect x="-17" y="-9" width="34" height="18" rx="7" fill="#4f46e5" />
              <rect x="-6" y="-6" width="14" height="12" rx="3" fill="#c7d2fe" />
              <circle cx="14" cy="-5" r="2" fill="#fde68a" />
              <circle cx="14" cy="5" r="2" fill="#fde68a" />
            </g>
          </svg>
          <ol className="mt-3 grid grid-cols-3 gap-3 text-center">
            {journey.map(({ icon: Icon, title, text }, i) => (
              <li key={title}>
                <span className="float-slow mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/30" style={{ animationDelay: `${i * 0.6}s` }}>
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <h3 className="mt-2 text-sm font-semibold sm:text-base">{title}</h3>
                <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </Reveal>

      <section aria-label="Features" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(({ icon: Icon, title, text }, i) => (
          <Reveal key={title} delay={i * 90}>
            <div className="card-hover group h-full rounded-xl border border-slate-200 bg-white/90 p-5 backdrop-blur">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-linear-to-br from-brand-50 to-indigo-100 text-brand-600 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                <Icon aria-hidden className="h-6 w-6" />
              </span>
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          </Reveal>
        ))}
      </section>

      <div className="text-center">
        <ApiStatus />
      </div>
    </div>
  )
}
