import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPanel } from './SearchPanel'
import type { OwnerMatch, SearchState } from './poolsApi'

vi.mock('../../lib/socket', () => ({ useServerEvent: vi.fn() }))

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { success: true, data: body } : { success: false, error: body }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const match = (id: string, score: number): OwnerMatch => ({
  section: 'CAR_OWNER',
  poolId: id,
  score,
  breakdown: [],
  reasons: ['Your pickup is on the route'],
  route: { from: 'Indiranagar', to: 'Airport' },
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seatsAvailable: 2,
  fare: { amount: 250, negotiable: false },
  pickup: { lat: 12.97, lng: 77.59, roadKmFromRequestedPickup: 0.4, eta: '2030-01-01T09:00:00.000Z' },
  dropoff: { lat: 13.19, lng: 77.7, roadKmToDestination: 0.2, eta: '2030-01-01T10:00:00.000Z' },
  driverDetourKm: 1.2,
  rideKm: 30,
  driverDepartsAt: '2030-01-01T08:50:00.000Z',
})

const state = (over: Partial<SearchState> = {}): SearchState => ({
  id: 's1',
  status: 'SEARCHING',
  windowSeconds: 300,
  expiresAt: new Date(Date.now() + 290_000).toISOString(),
  remainingSeconds: 290,
  matches: [],
  matching: { status: 'OK' },
  canCreatePoolingRequest: false,
  ...over,
})

function stub(search: () => SearchState, extra: Record<string, () => Promise<Response>> = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://x').pathname.replace(/^\/api/, '')
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (extra[path]) return extra[path]()
      if (path === '/pools/s1/search') return json({ search: search() })
      if (path === '/pools/s1/cancel-search') return json({})
      return json({ code: 'NOT_FOUND', message: 'unexpected ' + path }, 404)
    }),
  )
  return calls
}

function renderPanel(onEdit = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SearchPanel searchId="s1" windowSeconds={300} onEdit={onEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return onEdit
}

afterEach(() => vi.unstubAllGlobals())

describe('SearchPanel', () => {
  it('shows a countdown and that nothing fits yet while searching', async () => {
    stub(() => state())
    renderPanel()
    expect(await screen.findByRole('heading', { name: /searching for a pool/i })).toBeInTheDocument()
    expect(await screen.findByRole('timer')).toHaveTextContent(/^4:[4-9]\d$/)
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })

  it('lists pools that turn up while searching', async () => {
    stub(() => state({ matches: [match('a', 88)] }))
    renderPanel()
    const list = await screen.findByRole('list', { name: /matching pools/i })
    expect(within(list).getByText('Best match')).toBeInTheDocument()
    expect(within(list).getByText('88')).toBeInTheDocument()
  })

  it('warns when routing trouble means the list may be incomplete', async () => {
    stub(() => state({ matching: { status: 'DEGRADED' } }))
    renderPanel()
    expect(await screen.findByText(/couldn't check every pool just now/i)).toBeInTheDocument()
  })

  it('cancels the search and goes back to the form when asked to edit', async () => {
    const calls = stub(() => state())
    const onEdit = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /stop searching and edit my search/i }))
    await waitFor(() => expect(onEdit).toHaveBeenCalled())
    expect(calls).toContain('POST /pools/s1/cancel-search')
  })

  it('offers the two choices when the five minutes are over and nothing fits', async () => {
    stub(() => state({ status: 'SEARCH_TIMED_OUT', expiresAt: null, canCreatePoolingRequest: true }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: /search ended/i })).toBeInTheDocument()
    expect(screen.getByText(/no car-owner pool fits your trip/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create a passenger-pooling request/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit my search/i })).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('shows proposed groups, never a confirmed ride, after a passenger-pooling request', async () => {
    const group = {
      section: 'CAB',
      requestId: 'r2',
      score: 74,
      breakdown: [],
      reasons: ['You travel to the same area'],
      otherPeople: 1,
      groupSize: 3,
      pickup: { lat: 1, lng: 1, roadKmForYou: 0.5 },
      dropoff: { lat: 1, lng: 1, roadKmForYou: 0.7 },
      rideKm: 12,
      rideMinutes: 30,
      note: 'A proposed group, not a confirmed ride.',
    }
    const calls = stub(() => state({ status: 'SEARCH_TIMED_OUT', expiresAt: null, canCreatePoolingRequest: true }), {
      '/pools/s1/pooling-request': () => json({ pool: { id: 's1' }, groups: { status: 'OK', matches: [group] } }, 201),
    })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /create a passenger-pooling request/i }))

    expect(await screen.findByRole('heading', { name: /open to other passengers/i })).toBeInTheDocument()
    expect(screen.getByText(/share a cab with 1 other traveller/i)).toBeInTheDocument()
    expect(screen.getByText(/not a confirmed ride/i)).toBeInTheDocument()
    expect(calls).toContain('POST /pools/s1/pooling-request')
  })

  it('says so when a cancelled search is opened', async () => {
    stub(() => state({ status: 'CANCELLED', expiresAt: null }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: /search cancelled/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create a passenger-pooling request/i })).not.toBeInTheDocument()
  })
})
