import { Link } from 'react-router-dom'
import { Luggage, Route, ShieldCheck, Users } from 'lucide-react'
import { ApiStatus } from '../features/health/ApiStatus'

const features = [
  { icon: Route, title: 'Route-aware matching', text: 'Find people whose journey really overlaps yours, not just the same destination name.' },
  { icon: Luggage, title: 'Luggage-aware', text: 'We check that passengers and bags fit in the vehicle before suggesting a ride.' },
  { icon: Users, title: 'Pool Rooms', text: 'Once everyone agrees, chat and plan pickups together in a private room.' },
  { icon: ShieldCheck, title: 'Consent first', text: 'Women-only pools and live location sharing are opt-in and enforced by the server.' },
]

export function LandingPage() {
  return (
    <div className="space-y-12">
      <section className="py-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Share the ride. Split the cost.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          Pool-In connects people travelling along similar routes so they can coordinate a shared journey.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/register" className="rounded-md bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700">
            Get started
          </Link>
          <Link to="/how-it-works" className="rounded-md border border-slate-300 bg-white px-5 py-3 font-medium hover:bg-slate-100">
            How it works
          </Link>
        </div>
      </section>

      <section aria-label="Features" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-lg border border-slate-200 bg-white p-5">
            <Icon aria-hidden className="h-6 w-6 text-brand-600" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </section>

      <div className="text-center">
        <ApiStatus />
      </div>
    </div>
  )
}
