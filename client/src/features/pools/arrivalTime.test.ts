import { describe, expect, it } from 'vitest'
import { TIME_PATTERN, describeArrival, nextOccurrence } from './arrivalTime'

// A fixed local "now": 3:00 pm on 14 Jan 2030.
const now = new Date(2030, 0, 14, 15, 0, 0)
const at = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]

describe('nextOccurrence', () => {
  it('uses today when the time is still ahead', () => {
    expect(at(nextOccurrence('18:30', now))).toEqual([2030, 0, 14, 18, 30])
  })

  it('uses tomorrow when the time has already passed', () => {
    expect(at(nextOccurrence('09:15', now))).toEqual([2030, 0, 15, 9, 15])
  })

  it('uses tomorrow when the time is less than 10 minutes away', () => {
    expect(at(nextOccurrence('15:05', now))).toEqual([2030, 0, 15, 15, 5])
    expect(at(nextOccurrence('15:00', now))).toEqual([2030, 0, 15, 15, 0])
  })

  it('uses today when the time is exactly 10 minutes away', () => {
    expect(at(nextOccurrence('15:10', now))).toEqual([2030, 0, 14, 15, 10])
  })

  it('handles midnight and the end of the day', () => {
    expect(at(nextOccurrence('00:00', now))).toEqual([2030, 0, 15, 0, 0])
    expect(at(nextOccurrence('23:59', now))).toEqual([2030, 0, 14, 23, 59])
  })

  it('rolls over a month end', () => {
    const lateJan = new Date(2030, 0, 31, 22, 0, 0)
    expect(at(nextOccurrence('07:00', lateJan))).toEqual([2030, 1, 1, 7, 0])
  })

  it('always returns a moment at least 10 minutes ahead, within a day', () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 7, 30, 59]) {
        const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        const ms = nextOccurrence(t, now).getTime() - now.getTime()
        expect(ms).toBeGreaterThanOrEqual(10 * 60_000)
        expect(ms).toBeLessThanOrEqual(24 * 3_600_000 + 10 * 60_000)
      }
    }
  })
})

describe('describeArrival', () => {
  it('says today or tomorrow, with a 12-hour time', () => {
    expect(describeArrival(nextOccurrence('18:30', now), now)).toBe('today at 6:30 PM')
    expect(describeArrival(nextOccurrence('09:15', now), now)).toBe('tomorrow at 9:15 AM')
    expect(describeArrival(nextOccurrence('00:00', now), now)).toBe('tomorrow at 12:00 AM')
  })
})

describe('TIME_PATTERN', () => {
  it.each(['00:00', '09:05', '12:30', '23:59'])('accepts %s', (t) => expect(TIME_PATTERN.test(t)).toBe(true))
  it.each(['', '24:00', '9:05', '12:60', '12:5', '12:30:00', 'noon'])('rejects %j', (t) => expect(TIME_PATTERN.test(t)).toBe(false))
})
