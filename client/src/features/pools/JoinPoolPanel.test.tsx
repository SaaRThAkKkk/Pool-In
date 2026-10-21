import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JoinPoolPanel } from './JoinPoolPanel'

const here = { lat: 12.9716, lng: 77.5946, accuracy: 25, timestamp: 1 }
const inDays = (n: number) => format(new Date(Date.now() + n * 86_400_000), "yyyy-MM-dd'T'HH:mm")
const setDeparture = (value: string) => fireEvent.change(screen.getByLabelText(/departure/i), { target: { value } })

afterEach(() => vi.unstubAllGlobals())

describe('JoinPoolPanel', () => {
  it('uses the current location as a read-only start', () => {
    render(<JoinPoolPanel position={here} onClose={() => {}} />)
    const start = screen.getByLabelText(/^start/i)
    expect(start).toHaveValue('Current location (12.9716, 77.5946)')
    expect(start).toHaveAttribute('readonly')
  })

  it('asks for a typed start when there is no location', async () => {
    const u = userEvent.setup()
    render(<JoinPoolPanel position={null} onClose={() => {}} />)

    const start = screen.getByLabelText(/^start/i)
    expect(start).not.toHaveAttribute('readonly')

    await u.type(screen.getByLabelText(/destination/i), 'Airport')
    setDeparture(inDays(2))
    await u.click(screen.getByRole('button', { name: /find a pool/i }))
    expect(await screen.findByText(/enter where you are starting from/i)).toBeInTheDocument()
  })

  it('validates destination, departure and seats', async () => {
    const u = userEvent.setup()
    render(<JoinPoolPanel position={here} onClose={() => {}} />)

    await u.click(screen.getByRole('button', { name: /find a pool/i }))
    expect(await screen.findByText(/enter where you are going/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a departure date and time/i)).toBeInTheDocument()

    await u.type(screen.getByLabelText(/destination/i), 'Airport')
    setDeparture('2020-01-01T10:00')
    await u.clear(screen.getByLabelText(/seats/i))
    await u.type(screen.getByLabelText(/seats/i), '9')
    await u.click(screen.getByRole('button', { name: /find a pool/i }))

    expect(await screen.findByText(/departure must be in the future/i)).toBeInTheDocument()
    expect(screen.getByText(/at most 6 seats/i)).toBeInTheDocument()
  })

  it('is honest that matching is not available and sends nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const u = userEvent.setup()
    render(<JoinPoolPanel position={here} onClose={() => {}} />)

    await u.type(screen.getByLabelText(/destination/i), 'Airport')
    setDeparture(inDays(2))
    await u.click(screen.getByRole('button', { name: /find a pool/i }))

    expect(await screen.findByText(/pool matching isn't available yet/i)).toBeInTheDocument()
    expect(screen.getByText(/not sent or saved anywhere/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Cancel calls onClose', async () => {
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(<JoinPoolPanel position={here} onClose={onClose} />)
    await u.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
