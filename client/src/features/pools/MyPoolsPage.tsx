import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowRight, CalendarClock, CarFront, Plus, Users } from 'lucide-react'
import { MY_POOLS_KEY, categoryInfo, fetchMyPools, formatFare, type OwnerPool } from './poolsApi'

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTIALLY_FILLED: 'Partly filled',
  FULL: 'Full',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

function PoolCard({ pool }: { pool: OwnerPool }) {
  const { seats, pricing, vehicle } = pool
  return (
    <li className="card-hover rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <span>{pool.origin.label}</span>
          <ArrowRight aria-hidden className="h-4 w-4 text-slate-400" />
          <span>{pool.destination.label}</span>
        </h3>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
          {STATUS_LABEL[pool.status] ?? pool.status}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <CalendarClock aria-hidden className="h-4 w-4 text-brand-600" />
          <dt className="sr-only">Departure</dt>
          <dd>{format(new Date(pool.departureAt), 'EEE, d MMM yyyy · h:mm a')}</dd>
        </div>
        <div className="flex items-center gap-2">
          <CarFront aria-hidden className="h-4 w-4 text-brand-600" />
          <dt className="sr-only">Vehicle</dt>
          <dd>
            {vehicle.make} {vehicle.model} · {categoryInfo(vehicle.category)?.label ?? vehicle.category}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <Users aria-hidden className="h-4 w-4 text-brand-600" />
          <dt className="sr-only">Seats</dt>
          <dd>
            {seats.available} of {seats.offered} seats open
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="w-4 text-center font-semibold text-brand-600">
            ₹
          </span>
          <dt className="sr-only">Fare</dt>
          <dd>
            {formatFare(pricing.amount, pricing.currency)} per passenger ·{' '}
            <span className="font-medium">{pricing.negotiable ? 'Negotiable' : 'Fixed'}</span>
          </dd>
        </div>
      </dl>
    </li>
  )
}

export function MyPoolsPage() {
  const location = useLocation()
  const justCreated = (location.state as { created?: boolean } | null)?.created === true
  const pools = useQuery({ queryKey: MY_POOLS_KEY, queryFn: fetchMyPools })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">My pools</h1>
        <Link to="/pools/new" className="btn-primary !py-2 text-sm">
          <Plus aria-hidden className="h-4 w-4" /> Create a pool
        </Link>
      </div>

      {justCreated && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <span className="font-medium">Your pool is created.</span> Riders can't search for or join pools yet. Your pool
          is saved and will be visible to them when matching launches.
        </p>
      )}

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
          <p className="font-medium">You haven't created any pools yet.</p>
          <p className="mt-1 text-sm text-slate-600">Offer spare seats on a trip you're already making.</p>
          <Link to="/pools/new" className="btn-primary mt-4">
            Create your first pool
          </Link>
        </div>
      )}

      {pools.data && pools.data.length > 0 && (
        <ul className="space-y-4">
          {pools.data.map((pool) => (
            <PoolCard key={pool.id} pool={pool} />
          ))}
        </ul>
      )}
    </div>
  )
}
