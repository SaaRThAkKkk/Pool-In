import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Radar, Users } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { useServerEvent } from '../../lib/socket'
import { useCountdown } from '../auth/otpHelpers'
import { OwnerMatchList, PassengerGroupList } from './MatchList'
import {
  MY_POOLS_KEY,
  cancelSearch,
  createPoolingRequest,
  fetchPassengerMatches,
  fetchSearch,
  searchKey,
  type PassengerGroups,
} from './poolsApi'

const POLL_MS = 10_000

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
// over a socket, and the page also polls), and when the window closes it asks what to do next.
export function SearchPanel({ searchId, windowSeconds, startedDegraded = false, onEdit }: Props) {
  const queryClient = useQueryClient()
  const [groups, setGroups] = useState<PassengerGroups | null>(null)

  const search = useQuery({
    queryKey: searchKey(searchId),
    queryFn: () => fetchSearch(searchId),
    refetchInterval: (q) => (q.state.data?.status === 'SEARCHING' || q.state.data === undefined ? POLL_MS : false),
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
  // When the clock hits zero, ask the server so the search is closed properly.
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

  const poolingRequest = useMutation({
    mutationFn: () => createPoolingRequest(searchId),
    onSuccess: (data) => {
      setGroups(data.groups)
      void queryClient.invalidateQueries({ queryKey: MY_POOLS_KEY })
    },
  })
  const refreshGroups = useMutation({
    mutationFn: () => fetchPassengerMatches(searchId),
    onSuccess: setGroups,
  })

  const degraded = startedDegraded || state?.matching.status === 'DEGRADED'
  const matches = state?.matches ?? []
  const timedOut = state?.canCreatePoolingRequest === true
  const cancelled = state?.status === 'CANCELLED'
  const sharing = groups !== null

  // --- The user asked to be matched with other passengers -------------------------------------------------
  if (sharing) {
    return (
      <section aria-label="Passenger matches" className="animate-pop-in space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-emerald-900">Your request is open to other passengers</h1>
          <p className="mt-2 text-sm text-emerald-900/80">
            We saved it in the Cab section. Compatible passengers are proposed below, and more can appear as people search.
            Nothing is booked, and there is no driver or vehicle yet.
          </p>
        </div>
        {groups.status === 'DEGRADED' && (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            We couldn't check every request just now, so this list may be incomplete.
          </p>
        )}
        {groups.matches.length > 0 ? (
          <PassengerGroupList matches={groups.matches} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-6 text-center text-sm text-slate-600">
            No compatible passengers yet. Your request stays open, and you can check again later.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => refreshGroups.mutate()} disabled={refreshGroups.isPending} className="btn-secondary !py-2 text-sm">
            {refreshGroups.isPending ? 'Checking…' : 'Check again'}
          </button>
          <Link to="/pools" className="btn-primary !py-2 text-sm">
            View my pools
          </Link>
        </div>
      </section>
    )
  }

  // --- Searching, ended, or cancelled -------------------------------------------------------------------------
  const total = state?.windowSeconds ?? windowSeconds
  const percent = Math.max(0, Math.min(100, (secondsLeft / total) * 100))

  return (
    <section aria-label="Search for a pool" className="animate-pop-in space-y-5">
      <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-lg shadow-brand-500/10">
        <div className="flex items-start gap-4 p-6">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white">
            {running && <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-brand-500/40" />}
            <Radar aria-hidden className="relative h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {running ? 'Searching for a pool…' : cancelled ? 'Search cancelled' : 'Search ended'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {running
                ? "No pool fits yet. We're watching for new pools that match your trip, and we'll show them here the moment one appears."
                : cancelled
                  ? 'This search has been stopped.'
                  : matches.length > 0
                    ? 'The five minutes are over. These pools were found while we were looking:'
                    : "The five minutes are over and no car-owner pool fits your trip."}
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

      {running && matches.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
          Nothing yet. This page updates by itself.
        </p>
      )}

      {timedOut && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
          <h2 className="text-lg font-bold">What would you like to do?</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <Users aria-hidden className="h-6 w-6 text-brand-600" />
              <h3 className="mt-2 font-semibold">Pool with other passengers</h3>
              <p className="mt-1 text-sm text-slate-600">
                Save your request so other passengers can match with you and share a cab. No driver or vehicle is arranged yet.
              </p>
              <button type="button" onClick={() => poolingRequest.mutate()} disabled={poolingRequest.isPending} className="btn-primary mt-3 !py-2 text-sm">
                {poolingRequest.isPending ? 'Creating…' : 'Create a passenger-pooling request'}
              </button>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <Radar aria-hidden className="h-6 w-6 text-brand-600" />
              <h3 className="mt-2 font-semibold">Change your search</h3>
              <p className="mt-1 text-sm text-slate-600">Go back with your answers kept, adjust the time or your limits, and search again.</p>
              <button type="button" onClick={() => edit.mutate()} disabled={edit.isPending} className="btn-secondary mt-3 !py-2 text-sm">
                Edit my search
              </button>
            </div>
          </div>
          {poolingRequest.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {poolingRequest.error instanceof ApiError ? poolingRequest.error.message : 'Could not reach the server. Please try again.'}
            </p>
          )}
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
