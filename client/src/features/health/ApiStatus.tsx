import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

interface Health {
  status: string
  db: 'connected' | 'disconnected'
}

export function ApiStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
  })

  const text = isPending
    ? 'Checking server…'
    : isError
      ? 'Server unreachable'
      : `Server ok · database ${data.db}`
  const color = isPending ? 'bg-slate-400' : isError ? 'bg-red-500' : 'bg-green-500'

  return (
    <p role="status" className="inline-flex items-center gap-2 text-xs text-slate-500">
      <span aria-hidden className={`h-2 w-2 rounded-full ${color}`} />
      {text}
    </p>
  )
}
