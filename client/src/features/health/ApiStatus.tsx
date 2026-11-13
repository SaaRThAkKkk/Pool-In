import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

interface Health {
  status: string
  db: 'connected' | 'disconnected'
}

const RECHECK_MS = 5000
// A sleeping server (free hosting) takes up to about a minute to wake. Until then, say so instead of "unreachable".
const WAKING_CHECKS = 18

export function ApiStatus() {
  const { data, isPending, isError, errorUpdateCount } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    retry: false,
    // Keep checking while the server is not answering, so the page recovers by itself once it is up.
    refetchInterval: (query) => (query.state.status === 'error' ? RECHECK_MS : false),
  })

  const waking = isError && errorUpdateCount <= WAKING_CHECKS
  const text = isPending
    ? 'Checking server…'
    : waking
      ? 'Waking the server, this can take a minute…'
      : isError
        ? 'Server unreachable'
        : `Server ok · database ${data.db}`
  const color = isPending ? 'bg-slate-400' : waking ? 'bg-amber-500' : isError ? 'bg-red-500' : 'bg-green-500'

  return (
    <p role="status" className="inline-flex items-center gap-2 text-xs text-slate-500">
      <span aria-hidden className={`h-2 w-2 rounded-full ${color} ${waking ? 'animate-pulse' : ''}`} />
      {text}
    </p>
  )
}
