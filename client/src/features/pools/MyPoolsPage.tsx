import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { PoolCard } from './PoolCard'
import { MY_POOLS_KEY, fetchMyPools } from './poolsApi'

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
