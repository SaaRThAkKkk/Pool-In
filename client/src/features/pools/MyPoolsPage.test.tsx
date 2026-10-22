import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyPoolsPage } from './MyPoolsPage'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const pool = (over: object = {}) => ({
  id: 'r1',
  rideType: 'OWNER_VEHICLE',
  origin: { label: 'Indiranagar' },
  destination: { label: 'Airport' },
  departureAt: '2030-01-15T04:30:00.000Z',
  vehicle: { category: 'SUV', make: 'Toyota', model: 'Innova' },
  seats: { offered: 4, available: 3, taken: 1 },
  pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: false },
  status: 'OPEN',
  createdAt: '2029-12-01T00:00:00.000Z',
  ...over,
})

function renderPage(state?: unknown) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[{ pathname: '/pools', state }]}>
        <MyPoolsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('MyPoolsPage', () => {
  it('shows a loading state, then each pool with its key details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rides: [pool(), pool({ id: 'r2', destination: { label: 'Whitefield' }, pricing: { amount: 99.5, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true } })] })))
    renderPage()

    expect(screen.getByText(/loading your pools/i)).toBeInTheDocument()
    expect(await screen.findByText('Airport')).toBeInTheDocument()
    expect(screen.getAllByText(/toyota innova · suv/i)).toHaveLength(2)
    expect(screen.getAllByText(/3 of 4 seats open/i)).toHaveLength(2)
    expect(screen.getByText(/₹250 per passenger/i)).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.getByText(/₹99\.50 per passenger/i)).toBeInTheDocument()
    expect(screen.getByText('Negotiable')).toBeInTheDocument()
    expect(screen.getAllByText('Open')).toHaveLength(2)
  })

  it('shows flexible timing for a pool with no departure time, and the date when there is one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rides: [pool({ id: 'r1', departureAt: null }), pool({ id: 'r2', destination: { label: 'Whitefield' } })] })))
    renderPage()

    expect(await screen.findByText('Flexible timing')).toBeInTheDocument()
    expect(screen.getAllByText(/flexible timing/i)).toHaveLength(1)
    expect(screen.getByText(/jan 2030/i)).toBeInTheDocument()
  })

  it('invites the user to create a first pool when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rides: [] })))
    renderPage()

    expect(await screen.findByText(/haven't created any pools yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first pool/i })).toHaveAttribute('href', '/pools/new')
  })

  it('explains that others cannot join yet right after creating a pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rides: [pool()] })))
    renderPage({ created: true })

    expect(await screen.findByText(/your pool is created/i)).toBeInTheDocument()
    expect(screen.getByText(/can't search for or join pools yet/i)).toBeInTheDocument()
  })

  it('does not show that notice on a normal visit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ rides: [pool()] })))
    renderPage()
    await screen.findByText('Airport')
    expect(screen.queryByText(/your pool is created/i)).not.toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }), { status: 500 }))
      .mockResolvedValueOnce(ok({ rides: [pool()] }))
    vi.stubGlobal('fetch', fetchMock)
    const u = userEvent.setup()
    renderPage()

    expect(await screen.findByText(/could not load your pools/i)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Airport')).toBeInTheDocument()
  })
})
