import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MyPoolsPage } from './MyPoolsPage'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const luggage = { large: 1, medium: 0, cabin: 0, backpack: 2, oversized: 0 }

const ownerPool = (over: object = {}) => ({
  id: 'o1',
  section: 'CAR_OWNER',
  origin: { label: 'Indiranagar' },
  destination: { label: 'Airport' },
  arriveBy: '2030-01-15T04:30:00.000Z',
  luggage,
  status: 'OPEN',
  createdAt: '2029-12-01T00:00:00.000Z',
  vehicle: { category: 'SUV', make: 'Toyota', model: 'Innova' },
  seats: { offered: 4, available: 3, taken: 1 },
  pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: false },
  ...over,
})

const cabPool = (over: object = {}) => ({
  id: 'c1',
  section: 'CAB',
  origin: { label: 'Koramangala' },
  destination: { label: 'Railway Station' },
  arriveBy: '2030-02-01T08:00:00.000Z',
  luggage: { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 },
  status: 'OPEN',
  createdAt: '2029-12-02T00:00:00.000Z',
  people: 2,
  ...over,
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyPoolsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('MyPoolsPage', () => {
  it('shows a loading state, then pools from both sections, labelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ pools: [ownerPool(), cabPool()] })))
    renderPage()

    expect(screen.getByText(/loading your pools/i)).toBeInTheDocument()
    expect(await screen.findByText('Airport')).toBeInTheDocument()
    expect(screen.getByText('Railway Station')).toBeInTheDocument()
    expect(screen.getByText('Car owner')).toBeInTheDocument()
    expect(screen.getByText('Cab')).toBeInTheDocument()
  })

  it('shows the details of a car-owner pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ pools: [ownerPool()] })))
    renderPage()

    expect(await screen.findByText(/toyota innova · suv/i)).toBeInTheDocument()
    expect(screen.getByText(/3 of 4 seats open/i)).toBeInTheDocument()
    expect(screen.getByText(/₹250 per passenger/i)).toBeInTheDocument()
    expect(screen.getByText('Fixed')).toBeInTheDocument()
    expect(screen.getByText(/arrive by .*jan/i)).toBeInTheDocument()
    expect(screen.getByText(/1 large suitcases, 2 backpacks & small bags/i)).toBeInTheDocument()
  })

  it('shows the details of a cab request, with no vehicle or fare', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ pools: [cabPool()] })))
    renderPage()

    expect(await screen.findByText(/2 people travelling/i)).toBeInTheDocument()
    expect(screen.getByText('No luggage')).toBeInTheDocument()
    expect(screen.queryByText(/per passenger/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/seats open/i)).not.toBeInTheDocument()
  })

  it('handles an older pool that has no arrival time, and a decimal fare, and a negotiable one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ok({ pools: [ownerPool({ arriveBy: null, pricing: { amount: 99.5, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true } })] }),
      ),
    )
    renderPage()

    expect(await screen.findByText('Flexible timing')).toBeInTheDocument()
    expect(screen.getByText(/₹99\.50 per passenger/i)).toBeInTheDocument()
    expect(screen.getByText('Negotiable')).toBeInTheDocument()
  })

  it('warns that nobody can find or join pools yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ pools: [cabPool()] })))
    renderPage()
    expect(await screen.findByText(/matching isn't live yet/i)).toBeInTheDocument()
  })

  it('invites the user to pool in when there are none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ pools: [] })))
    renderPage()

    expect(await screen.findByText(/haven't pooled in yet/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /pool in/i }).every((l) => l.getAttribute('href') === '/pool-in')).toBe(true)
  })

  it('shows an error with a working retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }), { status: 500 }))
      .mockResolvedValueOnce(ok({ pools: [ownerPool()] }))
    vi.stubGlobal('fetch', fetchMock)
    const u = userEvent.setup()
    renderPage()

    expect(await screen.findByText(/could not load your pools/i)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Airport')).toBeInTheDocument()
  })
})
