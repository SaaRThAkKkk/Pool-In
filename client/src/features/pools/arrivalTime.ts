import { format } from 'date-fns'

export const MIN_LEAD_MINUTES = 10

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// The user picks only a clock time ("18:30"). This turns it into the next moment that clock time happens,
// at least MIN_LEAD_MINUTES from now: today if it is still ahead, otherwise tomorrow.
export function nextOccurrence(time: string, now: Date = new Date()): Date {
  const [hours, minutes] = time.split(':').map(Number)
  const candidate = new Date(now)
  candidate.setHours(hours ?? 0, minutes ?? 0, 0, 0)
  if (candidate.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

// "today at 6:30 PM" / "tomorrow at 6:30 AM", so the user can see which day their time was taken to mean.
export function describeArrival(target: Date, now: Date = new Date()): string {
  const sameDay = target.toDateString() === now.toDateString()
  return `${sameDay ? 'today' : 'tomorrow'} at ${format(target, 'h:mm a')}`
}
