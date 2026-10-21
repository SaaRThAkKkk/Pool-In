import { Luggage, Route, ShieldCheck, Users } from 'lucide-react'
import { Reveal } from '../components/Reveal'
import { ApiStatus } from '../features/health/ApiStatus'
import { HomeHero } from '../features/location/HomeHero'

const features = [
  { icon: Route, title: 'Route-aware matching', text: 'Find people whose journey really overlaps yours, not just the same destination name.' },
  { icon: Luggage, title: 'Luggage-aware', text: 'We check that passengers and bags fit in the vehicle before suggesting a ride.' },
  { icon: Users, title: 'Pool Rooms', text: 'Once everyone agrees, chat and plan pickups together in a private room.' },
  { icon: ShieldCheck, title: 'Consent first', text: 'Women-only pools and live location sharing are opt-in and enforced by the server.' },
]

export function LandingPage() {
  return (
    <div className="space-y-12">
      <HomeHero />

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
