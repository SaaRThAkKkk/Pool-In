import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowRight, CalendarClock, CarFront, CarTaxiFront, Luggage, Plus, Users } from 'lucide-react'
import { MY_POOLS_KEY, categoryInfo, describeLuggage, fetchMyPools, formatFare, type Pool } from './poolsApi'

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTIALLY_FILLED: 'Partly filled',
  FULL: 'Full',
  MATCHED: 'Matched',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

function Detail({ icon: Icon, label, children }: { icon: typeof Users; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-brand-600" />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function PoolCard({ pool }: { pool: Pool }) {
  const isOwner = pool.section === 'CAR_OWNER'
  const SectionIcon = isOwner ? CarFront : CarTaxiFront

  return (
    <li className="card-hover rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <span>{pool.origin.label}</span>
          <ArrowRight aria-hidden className="h-4 w-4 text-slate-400" />
          <span>{pool.destination.label}</span>
        </h3>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
            <SectionIcon aria-hidden className="h-3.5 w-3.5" />
            {isOwner ? 'Car owner' : 'Cab'}
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
            {STATUS_LABEL[pool.status] ?? pool.status}
          </span>
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <Detail icon={CalendarClock} label="Arrive by">
          {pool.arriveBy ? `Arrive by ${format(new Date(pool.arriveBy), 'EEE, d MMM · h:mm a')}` : 'Flexible timing'}
        </Detail>
        <Detail icon={Luggage} label="Luggage">
          {describeLuggage(pool.luggage)}
        </Detail>
        {pool.section === 'CAR_OWNER' ? (
          <>
            <Detail icon={CarFront} label="Vehicle">
              {pool.vehicle.make} {pool.vehicle.model} · {categoryInfo(pool.vehicle.category)?.label ?? pool.vehicle.category}
            </Detail>
            <Detail icon={Users} label="Seats">
              {pool.seats.available} of {pool.seats.offered} seats open
            </Detail>
            <div className="flex items-center gap-2 sm:col-span-2">
              <span aria-hidden className="w-4 text-center font-semibold text-brand-600">
                ₹
              </span>
              <dt className="sr-only">Fare</dt>
              <dd>
                {formatFare(pool.pricing.amount, pool.pricing.currency)} per passenger ·{' '}
                <span className="font-medium">{pool.pricing.negotiable ? 'Negotiable' : 'Fixed'}</span>
              </dd>
            </div>
          </>
        ) : (
          <Detail icon={Users} label="People">
            {pool.people} {pool.people === 1 ? 'person' : 'people'} travelling
          </Detail>
        )}
      </dl>
    </li>
  )
}

export function MyPoolsPage() {
  const pools = useQuery({ queryKey: MY_POOLS_KEY, queryFn: fetchMyPools })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">My pools</h1>
        <Link to="/pool-in" className="btn-primary !py-2 text-sm">
          <Plus aria-hidden className="h-4 w-4" /> Pool In
        </Link>
      </div>

      {pools.isPending && <p role="status">Loading your pools…</p>}

      {pools.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Could not load your pools.{' '}
          <button type="button" onClick={() => void pools.refetch()} className="font-medium underline">
            Try again
          </button>
        </p>
      )}

      {pools.data && pools.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-10 text-center">
          <p className="font-medium">You haven't pooled in yet.</p>
          <p className="mt-1 text-sm text-slate-600">Offer seats on a trip, or share a cab with others.</p>
          <Link to="/pool-in" className="btn-primary mt-4">
            Pool In
          </Link>
        </div>
      )}

      {pools.data && pools.data.length > 0 && (
        <>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Pool matching isn't live yet: nobody can find or join these pools until it launches.
          </p>
          <ul className="space-y-4">
            {pools.data.map((pool) => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
