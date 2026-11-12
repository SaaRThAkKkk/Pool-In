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
  nearest: [],
  groups: [],
  postedForOthers: false,
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
    expect(await screen.findByText(/nothing fits yet/i)).toBeInTheDocument()
  })

  it('lists pools that turn up while searching', async () => {
    stub(() => state({ matches: [match('a', 88)] }))
    renderPanel()
    const list = await screen.findByRole('list', { name: /matching pools/i })
    expect(within(list).getByText('Best match')).toBeInTheDocument()
    expect(within(list).getByText('88')).toBeInTheDocument()
  })

  it('has a Message button on each matching pool, which checks the match for this very search', async () => {
    stub(() => state({ matches: [match('pool-9', 88)] }))
    renderPanel()
    expect(await screen.findByRole('button', { name: /message the driver/i })).toBeInTheDocument()
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

  it('shows the closest pools that do not fit, with why, when nothing matches (never as matches)', async () => {
    stub(() =>
      state({
        nearest: [
          {
            poolId: 'n1',
            route: { from: 'Whitefield', to: 'Airport' },
            vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
            seatsAvailable: 3,
            fare: { amount: 250, negotiable: false },
            arriveBy: '2030-01-01T10:00:00.000Z',
            startGapKm: 4,
            endGapKm: 0.2,
            why: ['Its route passes about 4 km from your start, but you only want to travel 2 km to be picked up.'],
          },
        ],
      }),
    )
    renderPanel()
    const list = await screen.findByRole('list', { name: /pools that do not fit/i })
    expect(within(list).getByText(/doesn't fit your trip/i)).toBeInTheDocument()
    expect(within(list).getByText(/about 4 km from your start, but you only want to travel 2 km/i)).toBeInTheDocument()
    expect(within(list).getByText(/passes about 4 km from your start and 0\.2 km from your destination/i)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /matching pools/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/best match/i)).not.toBeInTheDocument()
  })

  it('hides the near misses once a pool really fits', async () => {
    const nearest = [{ poolId: 'n1', route: { from: 'A', to: 'B' }, vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' }, seatsAvailable: 1, fare: { amount: 1, negotiable: false }, arriveBy: '2030-01-01T10:00:00.000Z', startGapKm: 1, endGapKm: 1, why: ['x'] }]
    stub(() => state({ matches: [match('a', 88)], nearest }))
    renderPanel()
    await screen.findByRole('list', { name: /matching pools/i })
    expect(screen.queryByRole('list', { name: /pools that do not fit/i })).not.toBeInTheDocument()
  })

  it('shows other passengers\' open requests as proposed groups, never a confirmed ride', async () => {
    const group = {
      section: 'CAB' as const,
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
    stub(() => state({ groups: [group] }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: /other passengers heading your way/i })).toBeInTheDocument()
    expect(screen.getByText(/share a cab with 1 other traveller/i)).toBeInTheDocument()
    expect(screen.getByText(/not a confirmed ride/i)).toBeInTheDocument()
  })

  it('when the five minutes end with no pool, says so with a joke and that the request is posted for others', async () => {
    stub(() => state({ status: 'OPEN', expiresAt: null, postedForOthers: true }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: /looks like everyone's got money/i })).toBeInTheDocument()
    expect(screen.getByText(/nobody wants to pool at the moment/i)).toBeInTheDocument()
    expect(screen.getByText(/your request is now posted/i)).toBeInTheDocument()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view my pools/i })).toHaveAttribute('href', '/pools')
  })

  it('does not make the joke if a pool did turn up', async () => {
    stub(() => state({ status: 'OPEN', expiresAt: null, postedForOthers: true, matches: [match('a', 80)] }))
    renderPanel()
    expect(await screen.findByRole('list', { name: /matching pools/i })).toBeInTheDocument()
    expect(screen.queryByText(/nobody wants to pool/i)).not.toBeInTheDocument()
  })

  it('lets the user cancel the posted request and edit the search', async () => {
    const calls = stub(() => state({ status: 'OPEN', expiresAt: null, postedForOthers: true }))
    const onEdit = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /cancel this request and edit my search/i }))
    await waitFor(() => expect(onEdit).toHaveBeenCalled())
    expect(calls).toContain('POST /pools/s1/cancel-search')
  })
  it('says so when a cancelled search is opened', async () => {
    stub(() => state({ status: 'CANCELLED', expiresAt: null }))
    renderPanel()
    expect(await screen.findByRole('heading', { name: /search cancelled/i })).toBeInTheDocument()
  })
})
