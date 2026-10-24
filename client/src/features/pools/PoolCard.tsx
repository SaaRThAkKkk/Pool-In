import { format } from 'date-fns'
import { ArrowRight, CalendarClock, CarFront, CarTaxiFront, Luggage, Users, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { categoryInfo, describeLuggage, formatFare, type Pool } from './poolsApi'

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

function Detail({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-brand-600" />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

// One of the user's pools, from either section. Shared by My pools and the dashboard.
export function PoolCard({ pool }: { pool: Pool }) {
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
