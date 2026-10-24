import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Radar, Wallet } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { useServerEvent } from '../../lib/socket'
import { useCountdown } from '../auth/otpHelpers'
import { NearbyPoolList, OwnerMatchList, PassengerGroupList } from './MatchList'
import { MY_POOLS_KEY, cancelSearch, fetchSearch, searchKey } from './poolsApi'

const POLL_MS = 10_000
const OPEN_POLL_MS = 15_000

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

interface Props {
  searchId: string
  windowSeconds: number
  /** The server could not check every pool for the very first look. */
  startedDegraded?: boolean
  /** Return to the form with everything still filled in, after the search has been cancelled. */
  onEdit: () => void
}

// The five-minute search for a car-owner pool. It keeps looking while the window is open (new pools are pushed
// over a socket, and the page also polls). If nothing fits, the closest pools are shown with the reasons they do not
// fit. When the five minutes end with no pool, the request is posted so other passengers can find and join it.
export function SearchPanel({ searchId, windowSeconds, startedDegraded = false, onEdit }: Props) {
  const queryClient = useQueryClient()

  const search = useQuery({
    queryKey: searchKey(searchId),
    queryFn: () => fetchSearch(searchId),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status === undefined || status === 'SEARCHING') return POLL_MS
      return status === 'OPEN' ? OPEN_POLL_MS : false
    },
  })
  const state = search.data
  const running = !state || state.status === 'SEARCHING'

  // A pool that suits this search was just published: look again straight away.
  useServerEvent(
    'search:update',
    (payload) => {
      if ((payload as { searchId?: string } | null)?.searchId === searchId) void search.refetch()
    },
    running,
  )

  const secondsLeft = useCountdown(state?.expiresAt ?? undefined)
  // When the clock hits zero, ask the server so the request is posted properly.
  useEffect(() => {
    if (state?.status === 'SEARCHING' && state.expiresAt && secondsLeft === 0) void search.refetch()
  }, [secondsLeft, state?.status, state?.expiresAt, search])

  const edit = useMutation({
    mutationFn: () => cancelSearch(searchId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MY_POOLS_KEY })
      onEdit()
    },
  })

  const degraded = startedDegraded || state?.matching.status === 'DEGRADED'
  const matches = state?.matches ?? []
  const nearest = state?.nearest ?? []
  const groups = state?.groups ?? []
  const posted = state?.status === 'OPEN'
  const cancelled = state?.status === 'CANCELLED'

  const total = state?.windowSeconds ?? windowSeconds
  const percent = Math.max(0, Math.min(100, (secondsLeft / total) * 100))

  return (
    <section aria-label="Search for a pool" className="animate-pop-in space-y-5">
      <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-lg shadow-brand-500/10">
        <div className="flex items-start gap-4 p-6">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white">
            {running && <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-brand-500/40" />}
            {posted ? <Wallet aria-hidden className="relative h-7 w-7" /> : <Radar aria-hidden className="relative h-7 w-7" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {running ? 'Searching for a pool…' : posted ? "Looks like everyone's got money" : cancelled ? 'Search cancelled' : 'Search ended'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {running
                ? matches.length > 0
                  ? 'Pools that fit your trip so far:'
                  : "No pool fits yet. We're watching for new pools that match your trip, and we'll show them here the moment one appears."
                : posted
                  ? matches.length > 0
                    ? 'A pool that fits has appeared since your search ended:'
                    : "Nobody wants to pool at the moment, it seems. But we haven't given up on you: your request is now posted, so anyone heading your way can find it and team up with you."
                  : cancelled
                    ? 'This search has been stopped.'
                    : 'The search has ended.'}
            </p>
          </div>
          {running && (
            <p role="timer" aria-label="Time left" className="shrink-0 text-right font-mono text-2xl font-bold tabular-nums text-brand-700">
              {state ? mmss(secondsLeft) : '–:––'}
            </p>
          )}
        </div>
        {running && (
          <div aria-hidden className="h-1.5 bg-slate-100">
            <div className="h-full bg-linear-to-r from-brand-600 to-indigo-500 transition-[width] duration-1000 ease-linear" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      {degraded && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          We couldn't check every pool just now (routing trouble). We'll keep trying, but this list may be incomplete.
        </p>
      )}

      {search.isError && !state && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {search.error instanceof ApiError ? search.error.message : 'Could not reach the server.'} Retrying…
        </p>
      )}

      {matches.length > 0 && <OwnerMatchList matches={matches} />}

      {matches.length === 0 && nearest.length > 0 && <NearbyPoolList pools={nearest} />}

      {groups.length > 0 && (
        <section aria-label="Other passengers" className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Other passengers heading your way</h2>
            <p className="text-sm text-slate-600">
              These are proposals only. Nothing is booked, and there is no driver or vehicle yet.
            </p>
          </div>
          <PassengerGroupList matches={groups} />
        </section>
      )}

      {running && matches.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Nothing fits yet. This page updates by itself.
        </p>
      )}

      {posted && (
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/pools" className="btn-primary !py-2 text-sm">
            View my pools
          </Link>
          <button type="button" onClick={() => edit.mutate()} disabled={edit.isPending} className="btn-secondary !py-2 text-sm">
            Cancel this request and edit my search
          </button>
        </div>
      )}

      {running && (
        <button type="button" onClick={() => edit.mutate()} disabled={edit.isPending} className="text-sm font-medium text-slate-600 underline">
          Stop searching and edit my search
        </button>
      )}

      {cancelled && (
        <button type="button" onClick={onEdit} className="btn-secondary !py-2 text-sm">
          Back to my search
        </button>
      )}
    </section>
  )
}
