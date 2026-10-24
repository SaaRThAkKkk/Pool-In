import { format } from 'date-fns'
import { ArrowRight, CarFront, Clock, MapPin, Route, Users } from 'lucide-react'
import { categoryInfo, formatFare, type OwnerMatch, type PassengerMatch } from './poolsApi'

const scoreColor = (score: number) =>
  score >= 80
    ? 'bg-emerald-100 text-emerald-800 ring-emerald-200'
    : score >= 60
      ? 'bg-brand-100 text-brand-700 ring-brand-500/30'
      : 'bg-amber-100 text-amber-900 ring-amber-200'

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl ring-1 ${scoreColor(score)}`}>
      <span className="text-xl font-extrabold leading-none tabular-nums">{Math.round(score)}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide">match</span>
    </span>
  )
}

const km = (n: number) => `${n} km`
const time = (iso: string) => format(new Date(iso), 'h:mm a')

function Reasons({ reasons }: { reasons: string[] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-brand-700">Why this match</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </details>
  )
}

// Ranked car-owner pools that fit the passenger, best first. Every one has already passed every hard rule.
export function OwnerMatchList({ matches }: { matches: OwnerMatch[] }) {
  return (
    <ol aria-label="Matching pools" className="space-y-4">
      {matches.map((m, i) => (
        <li key={m.poolId} className="animate-pop-in rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="flex items-start gap-4">
            <ScoreBadge score={m.score} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{i === 0 ? 'Best match' : `Match ${i + 1}`}</p>
              <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <span>{m.route.from}</span>
                <ArrowRight aria-hidden className="h-4 w-4 text-slate-400" />
                <span>{m.route.to}</span>
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <CarFront aria-hidden className="h-4 w-4 text-brand-600" />
                  {m.vehicle.make} {m.vehicle.model} · {categoryInfo(m.vehicle.category)?.label ?? m.vehicle.category}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users aria-hidden className="h-4 w-4 text-brand-600" />
                  {m.seatsAvailable} seat{m.seatsAvailable === 1 ? '' : 's'} free
                </span>
                <span>
                  {formatFare(m.fare.amount)} per person · <span className="font-medium">{m.fare.negotiable ? 'Negotiable' : 'Fixed'}</span>
                </span>
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
              <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <dt className="text-xs text-slate-500">Pickup</dt>
                <dd className="font-medium">
                  about {time(m.pickup.eta)} · {km(m.pickup.roadKmFromRequestedPickup)} from you
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
              <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <dt className="text-xs text-slate-500">Drop-off</dt>
                <dd className="font-medium">
                  about {time(m.dropoff.eta)} · {km(m.dropoff.roadKmToDestination)} from your destination
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Route aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <div>
                <dt className="text-xs text-slate-500">Ride together</dt>
                <dd>{km(m.rideKm)}</dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <div>
                <dt className="text-xs text-slate-500">Driver's extra distance</dt>
                <dd>{km(m.driverDetourKm)}</dd>
              </div>
            </div>
          </dl>

          <Reasons reasons={m.reasons} />
          <p className="mt-3 text-xs text-slate-500">Times and distances are estimates. Joining a pool isn't available yet.</p>
        </li>
      ))}
    </ol>
  )
}

// Passengers who could share a cab. A proposal only: there is no driver or vehicle, and nothing is booked.
export function PassengerGroupList({ matches }: { matches: PassengerMatch[] }) {
  return (
    <ol aria-label="Proposed groups" className="space-y-4">
      {matches.map((m, i) => (
        <li key={m.requestId} className="animate-pop-in rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
          <div className="flex items-start gap-4">
            <ScoreBadge score={m.score} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{i === 0 ? 'Best group' : `Group ${i + 1}`}</p>
              <h3 className="text-lg font-semibold">
                Share a cab with {m.otherPeople} other {m.otherPeople === 1 ? 'traveller' : 'travellers'}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                A group of {m.groupSize} · {km(m.rideKm)} · about {m.rideMinutes} min
              </p>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Shared pickup</dt>
              <dd className="font-medium">{km(m.pickup.roadKmForYou)} from you</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">Shared drop-off</dt>
              <dd className="font-medium">{km(m.dropoff.roadKmForYou)} from your destination</dd>
            </div>
          </dl>
          <Reasons reasons={m.reasons} />
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{m.note}</p>
        </li>
      ))}
    </ol>
  )
}
