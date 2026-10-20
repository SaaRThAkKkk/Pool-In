import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'

export const CODE_LENGTH = 6

// Seconds remaining until an ISO timestamp (0 when absent or passed).
export function useCountdown(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0
}

export function otpErrorText(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) {
    const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining
    return remaining !== undefined
      ? `${err.message}. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
      : err.message
  }
  return 'Could not reach the server. Please try again.'
}
