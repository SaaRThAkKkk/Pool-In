import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoolInPage } from './PoolInPage'

// Leaflet needs a real layout engine; the map is checked in the browser. This stub shows what it was given.
vi.mock('../maps/RoutePreviewMap', () => ({
  RoutePreviewMap: ({ start, end, path }: { start: { label: string } | null; end: { label: string } | null; path: unknown[] | null }) => (
    <div data-testid="route-map">{`start:${start?.label ?? 'none'} end:${end?.label ?? 'none'} path:${path ? path.length : 0}`}</div>
  ),
}))

// The real picker is a Leaflet map. This stand-in lets a test "tap" a spot and confirm it through the same callbacks.
vi.mock('../maps/MapPicker', () => ({
  MapPicker: ({ title, onConfirm, onClose }: { title: string; onConfirm: (p: unknown) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={() => onConfirm({ id: 'pin:1', title: 'Pinned spot', subtitle: 'Bengaluru', label: 'Pinned spot, Bengaluru', lat: 12.93, lng: 77.61 })}>
        use fake pin
      </button>
      <button type="button" onClick={onClose}>
        close fake map
      </button>
    </div>
  ),
}))

// No real sockets in these tests: the page also polls, and the socket behaviour is tested on its own.
vi.mock('../../lib/socket', () => ({ useServerEvent: vi.fn() }))

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })

const airport = { id: 'N9', title: 'Kempegowda International Airport', subtitle: 'Devanahalli, Bengaluru', label: 'Kempegowda International Airport, Devanahalli, Bengaluru', lat: 13.1986, lng: 77.7066 }
const indiranagar = { id: 'N1', title: 'Indiranagar', subtitle: 'Bengaluru, Karnataka', label: 'Indiranagar, Bengaluru, Karnataka', lat: 12.9784, lng: 77.6408 }
const route = { distanceMeters: 35214.6, durationSeconds: 2140.4, path: [[12.97, 77.64], [13.19, 77.7]] }

const emptyLuggage = { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 }
const ownerCreated = { outcome: 'POOL_CREATED', section: 'CAR_OWNER', pool: { id: 'p1', matchable: true } }
// A cab request saved without searching (place search was down, so there were no coordinates).
const cabCreated = { outcome: 'REQUEST_CREATED', section: 'CAB', pool: { id: 'c1' }, matching: { status: 'NEEDS_COORDINATES', matches: [] } }
// The five-minute search has started: no pool fits yet.
const searchStarted = { outcome: 'SEARCH_STARTED', section: 'CAB', pool: { id: 'c1' }, windowSeconds: 300, matching: { status: 'OK', matches: [] } }
const runningSearch = () => ({
  id: 'c1',
  status: 'SEARCHING',
  windowSeconds: 300,
  expiresAt: new Date(Date.now() + 290_000).toISOString(),
  remainingSeconds: 290,
  matches: [],
  matching: { status: 'OK' },
  nearest: [],
  groups: [],
  postedForOthers: false,
})
const clientMatch = (poolId: string, score: number) => ({
  section: 'CAR_OWNER',
  poolId,
  score,
  breakdown: [],
  reasons: ['Pickup is 1 km from you by road, within your 2 km limit.'],
  route: { from: 'Indiranagar', to: 'Airport' },
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seatsAvailable: 3,
  fare: { amount: 250, negotiable: false },
  pickup: { lat: 12.99, lng: 77.65, roadKmFromRequestedPickup: 1, eta: '2030-06-01T08:00:00.000Z' },
  dropoff: { lat: 13.18, lng: 77.7, roadKmToDestination: 0.5, eta: '2030-06-01T08:40:00.000Z' },
  driverDetourKm: 0.2,
  rideKm: 20,
  driverDepartsAt: '2030-06-01T07:50:00.000Z',
})

type Handlers = Partial<Record<'places' | 'route' | 'pools' | 'search' | 'cancel', (url: URL) => Response>>

function stubApi(handlers: Handlers = {}) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    if (/^\/api\/pools\/[^/]+\/search$/.test(url.pathname)) return (handlers.search ?? (() => ok({ search: runningSearch() })))(url)
    if (/^\/api\/pools\/[^/]+\/cancel-search$/.test(url.pathname) && init?.method === 'POST') return (handlers.cancel ?? (() => ok({})))(url)
    switch (url.pathname) {
      case '/api/maps/places':
        return (handlers.places ?? (() => ok({ places: [airport, indiranagar] })))(url)
      case '/api/maps/route':
        return (handlers.route ?? (() => ok({ route })))(url)
      case '/api/pools':
        return (handlers.pools ?? (() => ok(ownerCreated, 201)))(url)
      case '/api/pools/mine':
        return ok({ pools: [] })
      case '/api/chat/conversations':
        return ok({ conversation: { id: 'conv1', kind: 'OWNER_MATCH', with: { name: 'Ravi', role: 'DRIVER' }, trip: { from: 'a', to: 'b' }, lastMessage: null, unread: 0, updatedAt: '2030-01-01T00:00:00.000Z' } })
    }
    throw new Error(`unexpected request ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit?][]
  return {
    fetchMock,
    posted: () => {
      const call = calls().find(([u]) => u === '/api/pools')
      return call ? JSON.parse(call[1]!.body as string) : undefined
    },
    cancelled: () => calls().some(([u, init]) => /cancel-search$/.test(u) && init?.method === 'POST'),
    submitted: () => calls().some(([u]) => u === '/api/pools'),
    routeCalls: () => calls().filter(([u]) => u.startsWith('/api/maps/route')).map(([u]) => new URL(u, 'http://localhost')),
  }
}

function stubGeolocation() {
  const watchPosition = vi.fn((success: PositionCallback) => {
    success({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 25 }, timestamp: 1 } as GeolocationPosition)
    return 1
  })
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch: vi.fn() }, configurable: true })
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/pool-in']}>
        <Routes>
          <Route path="/pool-in" element={<PoolInPage />} />
          <Route path="/pools" element={<p>my pools page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const TIME = '18:30' // the clock time most tests choose to arrive by
const clockIn = (minutes: number) => format(new Date(Date.now() + minutes * 60_000), 'HH:mm')
type User = ReturnType<typeof userEvent.setup>

const startField = () => screen.getByRole('combobox', { name: /starting location/i })
const destField = () => screen.getByRole('combobox', { name: /^destination$/i })
const arrival = () => screen.getByLabelText(/reach the destination by/i)
const submitButton = () => document.querySelector('form button[type="submit"]') as HTMLButtonElement
const submit = (u: User) => u.click(submitButton())
const ownMode = (u: User) => u.click(screen.getByRole('radio', { name: /i own the vehicle/i }))
const cabMode = (u: User) => u.click(screen.getByRole('radio', { name: /pool a cab/i }))

async function ready() {
  await waitFor(() => expect(startField()).toHaveValue('Current location'))
}

async function pickDestination(u: User) {
  await u.type(destField(), 'kempe')
  await u.click(await screen.findByRole('option', { name: /kempegowda/i }))
}

async function fillTrip(u: User) {
  await pickDestination(u)
  fireEvent.change(arrival(), { target: { value: TIME } })
}

async function fillOwner(u: User) {
  await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'SEDAN')
  await u.type(screen.getByLabelText(/^make/i), 'Honda')
  await u.type(screen.getByLabelText(/^model/i), 'City')
  await u.clear(screen.getByLabelText(/seats you can offer/i))
  await u.type(screen.getByLabelText(/seats you can offer/i), '3')
  await u.type(screen.getByLabelText(/fare per passenger/i), '250')
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('PoolInPage: the shared trip questions', () => {
  it('asks for the start (preset to the live location), destination, arrival time and luggage', async () => {
    stubApi()
    stubGeolocation()
    renderPage()
    await ready()

    expect(screen.getByRole('heading', { name: 'Pool In' })).toBeInTheDocument()
    expect(screen.getByText(/location confirmed/i)).toBeInTheDocument()
    expect(destField()).toBeInTheDocument()
    expect(arrival()).toHaveAttribute('type', 'time')
    expect(document.querySelector('input[type="date"], input[type="datetime-local"]')).toBeNull()
    expect(screen.getByRole('group', { name: /large suitcases/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/departure/i)).not.toBeInTheDocument()
  })

  it('shows neither the vehicle questions nor the people counter until a choice is made', async () => {
    stubApi()
    stubGeolocation()
    renderPage()
    await ready()

    expect(screen.getByRole('radio', { name: /i own the vehicle/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /pool a cab/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByLabelText(/vehicle type/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/people travelling together/i)).not.toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Pool In')
  })

  it('previews the route once the destination is chosen', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent(`end:${airport.label} path:2`))
    expect(screen.getByText(/35\.2 km · about 36 min/i)).toBeInTheDocument()
    expect(api.routeCalls()[0]!.searchParams.get('fromLat')).toBe('12.972')
  })

  it('works without a live location: both ends are searched for', async () => {
    stubApi()
    const u = userEvent.setup()
    renderPage()

    await u.type(startField(), 'indi')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    await pickDestination(u)

    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent(/start:Indiranagar.*end:Kempegowda.*path:2/))
  })

  it('stops following the live location once the user types their own start', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.clear(startField())
    await u.type(startField(), 'Whitefield')
    expect(startField()).toHaveValue('Whitefield')
    expect(screen.queryByText(/location confirmed/i)).not.toBeInTheDocument()
  })
})

describe('PoolInPage: changing the starting location', () => {
  it('offers the suggestions list on focus, with "my current location" when the start is something else', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /clear starting location/i }))
    expect(startField()).toHaveValue('')
    expect(await screen.findByRole('option', { name: /my current location/i })).toBeInTheDocument()

    await u.type(startField(), 'indira')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    expect(startField()).toHaveValue(indiranagar.label)
    expect(screen.getByTestId('route-map')).toHaveTextContent('start:Indiranagar')

    // Back to the live location from the same list.
    await u.click(startField())
    await u.click(await screen.findByRole('option', { name: /my current location/i }))
    expect(startField()).toHaveValue('Current location')
  })

  it('selects the text on focus so typing replaces the current location', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(startField())
    await u.keyboard('indira')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    expect(startField()).toHaveValue(indiranagar.label)
  })

  it('sends the place chosen as the start', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /clear starting location/i }))
    await u.type(startField(), 'indira')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)

    await screen.findByRole('heading', { name: /your pool is created/i })
    expect(api.posted().origin).toEqual({ label: indiranagar.label, coordinates: { lat: 12.9784, lng: 77.6408 } })
  })

  it('lets the start be chosen on the map', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /choose starting location on the map/i }))
    expect(screen.getByRole('dialog', { name: /choose your starting location/i })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /use fake pin/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(startField()).toHaveValue('Pinned spot, Bengaluru')
    expect(screen.getByTestId('route-map')).toHaveTextContent('start:Pinned spot, Bengaluru')

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)
    await screen.findByRole('heading', { name: /your pool is created/i })
    expect(api.posted().origin).toEqual({ label: 'Pinned spot, Bengaluru', coordinates: { lat: 12.93, lng: 77.61 } })
  })

  it('lets the destination be chosen on the map too, and closing the map changes nothing', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /choose destination on the map/i }))
    await u.click(screen.getByRole('button', { name: /close fake map/i }))
    expect(destField()).toHaveValue('')

    await u.click(screen.getByRole('button', { name: /choose destination on the map/i }))
    await u.click(screen.getByRole('button', { name: /use fake pin/i }))
    expect(destField()).toHaveValue('Pinned spot, Bengaluru')
    expect(startField()).toHaveValue('Current location')
  })
})

describe('PoolInPage: the two options change the form', () => {
  it('"I own the vehicle" asks for vehicle, seats and fare, and not for people', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)

    expect(screen.getByRole('radio', { name: /i own the vehicle/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText(/vehicle type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^make/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/seats you can offer/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fare per passenger/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/negotiable/i)).not.toBeChecked()
    expect(screen.getByText(/not for running a taxi service/i)).toBeInTheDocument()
    expect(screen.queryByText(/people travelling together/i)).not.toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Create my pool')
  })

  it('"Pool a cab" asks how many people, and not for vehicle or fare', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await cabMode(u)

    expect(screen.getByText(/people travelling together/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more people/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/vehicle type/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fare per passenger/i)).not.toBeInTheDocument()
    expect(screen.getByText(/look for a pool that already suits your trip/i)).toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Find a pool')
  })

  it('swaps the panel when the choice changes, and keeps what was typed', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)
    await u.type(screen.getByLabelText(/^make/i), 'Honda')
    await cabMode(u)
    expect(screen.queryByLabelText(/^make/i)).not.toBeInTheDocument()
    await ownMode(u)
    expect(screen.getByLabelText(/^make/i)).toHaveValue('Honda')
  })

  it('keeps the luggage and trip answers when the choice changes', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await ownMode(u)
    await cabMode(u)
    expect(within(screen.getByRole('group', { name: /large suitcases/i })).getByRole('status')).toHaveTextContent('1')
  })

  it('asks the user to choose when they submit without choosing', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await submit(u)

    expect(await screen.findByText(/^choose how you want to pool$/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })
})

describe('PoolInPage: "I own the vehicle" -> car-owner section', () => {
  it('sends the whole trip, luggage and vehicle, and shows the result', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await u.click(screen.getByRole('button', { name: /more backpacks/i }))
    await u.click(screen.getByRole('button', { name: /more backpacks/i }))
    await ownMode(u)
    await fillOwner(u)
    await u.click(screen.getByLabelText(/negotiable/i))
    await submit(u)

    expect(await screen.findByRole('heading', { name: /your pool is created/i })).toBeInTheDocument()
    expect(screen.getByText(/car owner section/i)).toBeInTheDocument()
    expect(screen.getByText(/passengers searching along your route can now be matched with it/i)).toBeInTheDocument()
    expect(screen.getByText(/joining a pool isn't available yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view my pools/i })).toHaveAttribute('href', '/pools')

    expect(api.posted()).toEqual({
      mode: 'OWN_VEHICLE',
      origin: { label: 'Current location', coordinates: { lat: 12.972, lng: 77.595 } },
      destination: { label: airport.label, coordinates: { lat: 13.1986, lng: 77.7066 } },
      arriveBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      luggage: { ...emptyLuggage, large: 1, backpack: 2 },
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seats: 3,
      askingPrice: 250,
      negotiable: true,
      maxDriverDetourKm: 5, // the starting value of the "most extra distance" field
    })
  })

  it('says so when a published pool could not be given a route yet (so it cannot be matched)', async () => {
    stubApi({ pools: () => ok({ ...ownerCreated, pool: { id: 'p1', matchable: false } }, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)

    expect(await screen.findByText(/passengers can't be matched with it yet/i)).toBeInTheDocument()
  })

  it('sends a fixed fare when the negotiable box is left unticked', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)

    await screen.findByRole('heading', { name: /your pool is created/i })
    expect(api.posted().negotiable).toBe(false)
  })

  it('lets the user pool in again after a result', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)
    await u.click(await screen.findByRole('button', { name: /pool in again/i }))

    expect(screen.getByRole('radiogroup', { name: /how do you want to pool/i })).toBeInTheDocument()
  })

  it('shows every missing owner field and sends nothing', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)
    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await submit(u)

    expect(await screen.findByText(/enter your destination/i)).toBeInTheDocument()
    expect(screen.getByText(/choose the time you need to arrive/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a vehicle type/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle make/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle model/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the number of seats/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the fare/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('limits seats to what the chosen vehicle can carry', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'HATCHBACK')
    expect(screen.getByText(/up to 4 passengers for this vehicle type/i)).toBeInTheDocument()
    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await u.type(screen.getByLabelText(/seats you can offer/i), '5')
    await submit(u)

    expect(await screen.findByText(/a hatchback can offer at most 4 seats/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it.each([
    ['a negative fare', '-5', /fare cannot be negative/i],
    ['a fare with three decimals', '10.123', /at most 2 decimal places/i],
    ['an absurdly large fare', '999999', /fare cannot exceed/i],
  ])('rejects %s', async (_label, value, message) => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await u.clear(screen.getByLabelText(/fare per passenger/i))
    await u.type(screen.getByLabelText(/fare per passenger/i), value)
    await submit(u)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })
})

describe('PoolInPage: "Pool a cab" -> match now, else a five-minute search', () => {
  it('sends the trip, luggage, number of people and limits (and no vehicle or fare)', async () => {
    const api = stubApi({ pools: () => ok(searchStarted, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await u.click(screen.getByRole('button', { name: /more cabin bags/i }))
    await cabMode(u)
    await u.click(screen.getByRole('button', { name: /more people/i }))
    await u.click(screen.getByRole('button', { name: /more people/i }))
    await submit(u)

    expect(await screen.findByRole('heading', { name: /searching for a pool/i })).toBeInTheDocument()
    expect(api.posted()).toEqual({
      mode: 'POOL_CAB',
      origin: { label: 'Current location', coordinates: { lat: 12.972, lng: 77.595 } },
      destination: { label: airport.label, coordinates: { lat: 13.1986, lng: 77.7066 } },
      arriveBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      luggage: { ...emptyLuggage, cabin: 1 },
      people: 3,
      maxPickupTravelKm: 2, // starting values of the limit fields
      maxDropoffTravelKm: 2,
    })
  })

  it('starts with sensible limits the user can change, and an empty optional budget', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()
    await cabMode(u)

    expect(screen.getByLabelText(/most you'll travel to be picked up/i)).toHaveValue(2)
    expect(screen.getByLabelText(/most from drop-off to your destination/i)).toHaveValue(2)
    expect(screen.getByLabelText(/most you'd pay per person/i)).toHaveValue(null)
    expect(screen.getByText(/fixed fare above this is left out\. negotiable fares are kept/i)).toBeInTheDocument()
  })

  it('sends the limits the user chose, and leaves blank ones out so the server can use its defaults', async () => {
    const api = stubApi({ pools: () => ok(searchStarted, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await u.clear(screen.getByLabelText(/most you'll travel to be picked up/i))
    await u.type(screen.getByLabelText(/most you'll travel to be picked up/i), '1.5')
    await u.clear(screen.getByLabelText(/most from drop-off to your destination/i)) // blank = no limit
    await u.type(screen.getByLabelText(/most you'd pay per person/i), '400')
    await submit(u)

    await screen.findByRole('heading', { name: /searching for a pool/i })
    const body = api.posted()
    expect(body.maxPickupTravelKm).toBe(1.5)
    expect(body.maxBudget).toBe(400)
    expect(body).not.toHaveProperty('maxDropoffTravelKm')
  })

  it.each([
    ['a pickup limit that is too small', 'maxPickupTravelKm', '0', /enter between 0\.1 and 20 km/i],
    ['a pickup limit that is too large', 'maxPickupTravelKm', '50', /enter between 0\.1 and 20 km/i],
    ['a drop-off limit that is too large', 'maxDropoffTravelKm', '99', /enter between 0\.1 and 20 km/i],
    ['a budget of zero', 'maxBudget', '0', /enter at least ₹1/i],
    ['a budget with three decimals', 'maxBudget', '10.123', /at most 2 decimal places/i],
  ])('rejects %s', async (_label, field, value, message) => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    const input = document.getElementById(field) as HTMLInputElement
    await u.clear(input)
    await u.type(input, value)
    await submit(u)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('shows the driver\'s matching fields only for "I own the vehicle", with the detour starting at 5 km', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)
    expect(screen.getByLabelText(/most extra distance you'll drive/i)).toHaveValue(5)
    expect(screen.getByLabelText(/luggage space for riders/i)).toHaveValue(null)
    expect(screen.queryByLabelText(/most you'll travel to be picked up/i)).not.toBeInTheDocument()

    await cabMode(u)
    expect(screen.queryByLabelText(/most extra distance you'll drive/i)).not.toBeInTheDocument()
  })

  it('sends the owner\'s detour limit and luggage space, and leaves a cleared detour field out', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await u.clear(screen.getByLabelText(/most extra distance you'll drive/i))
    await u.type(screen.getByLabelText(/most extra distance you'll drive/i), '2.5')
    await u.type(screen.getByLabelText(/luggage space for riders/i), '6')
    await submit(u)

    await screen.findByRole('heading', { name: /your pool is created/i })
    expect(api.posted()).toMatchObject({ maxDriverDetourKm: 2.5, luggageSpaceUnits: 6 })
  })

  it.each([
    ['a negative detour', 'maxDriverDetourKm', '-1', /enter between 0 and 50 km/i],
    ['a huge detour', 'maxDriverDetourKm', '200', /enter between 0 and 50 km/i],
    ['fractional luggage space', 'luggageSpaceUnits', '2.5', /whole number of bags/i],
  ])('rejects %s for an owner', async (_label, field, value, message) => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    const input = document.getElementById(field) as HTMLInputElement
    await u.clear(input)
    await u.type(input, value)
    await submit(u)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('does not ask for vehicle details to submit a cab request', async () => {
    const api = stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u) // touch the owner fields and leave them empty ...
    await cabMode(u) // ... then switch: the empty owner fields must not block this submit
    await submit(u)

    await screen.findByRole('heading', { name: /your pool request is saved/i })
    expect(api.posted().mode).toBe('POOL_CAB')
    expect(api.posted().people).toBe(1)
  })

  it('explains why a request was saved without a search (a place was not picked from the list)', async () => {
    stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/couldn't search for a match because a place wasn't picked/i)).toBeInTheDocument()
  })

  it('with no pool yet, shows the five-minute search instead of saving a request straight away', async () => {
    stubApi({ pools: () => ok(searchStarted, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByRole('heading', { name: /searching for a pool/i })).toBeInTheDocument()
    expect(screen.getByText(/no pool fits yet/i)).toBeInTheDocument()
    expect(await screen.findByRole('timer')).toHaveTextContent(/^4:[5-9]\d$/) // about 4:50 left of 5:00
  })

  it('shows the matches, best first, when a pool already fits (and says nothing new was created)', async () => {
    stubApi({
      pools: () =>
        ok({
          outcome: 'MATCHES_FOUND',
          matching: { status: 'OK', sections: ['CAR_OWNER', 'CAB'], matches: [clientMatch('a', 91), clientMatch('b', 70)] },
        }),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByRole('heading', { name: /we found 2 pools that fit your trip/i })).toBeInTheDocument()
    expect(screen.getByText(/we didn't create a new request/i)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: /matching pools/i })
    const items = Array.from(list.children) // top-level cards only; each has its own "why" list inside
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Best match')
    expect(items[0]).toHaveTextContent('91')
    expect(items[1]).toHaveTextContent('Match 2')
  })

  it('lets the user message a matching pool\'s driver, sending the trip they searched for (nothing was saved)', async () => {
    const api = stubApi({ pools: () => ok({ outcome: 'MATCHES_FOUND', matching: { status: 'OK', matches: [clientMatch('pool-7', 91)] } }) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)
    await u.click(await screen.findByRole('button', { name: /message the driver/i }))

    await waitFor(() => expect(api.fetchMock.mock.calls.some(([url]) => url === '/api/chat/conversations')).toBe(true))
    const call = api.fetchMock.mock.calls.find(([url]) => url === '/api/chat/conversations')!
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.poolId).toBe('pool-7')
    expect(body.trip).toMatchObject({ mode: 'POOL_CAB', people: 1, destination: { label: airport.label } })
  })

  it('warns that the list may be incomplete when some pools could not be checked', async () => {
    stubApi({
      pools: () => ok({ outcome: 'MATCHES_FOUND', matching: { status: 'DEGRADED', matches: [clientMatch('a', 80)] } }),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/couldn't check every pool just now/i)).toBeInTheDocument()
  })

  it('"Change my search" goes back to the form with every answer still filled in', async () => {
    stubApi({ pools: () => ok({ outcome: 'MATCHES_FOUND', matching: { status: 'OK', matches: [clientMatch('a', 80)] } }) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await u.click(screen.getByRole('button', { name: /more cabin bags/i }))
    await submit(u)
    await u.click(await screen.findByRole('button', { name: /change my search/i }))

    expect(destField()).toHaveValue(airport.label)
    expect(arrival()).toHaveValue(TIME)
    expect(screen.getByRole('radio', { name: /pool a cab/i })).toHaveAttribute('aria-checked', 'true')
    expect(within(screen.getByRole('group', { name: /cabin bags/i })).getByRole('status')).toHaveTextContent('1')
  })

  it('"Edit my search" while searching stops the search and returns to the filled-in form', async () => {
    const api = stubApi({ pools: () => ok(searchStarted, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)
    await u.click(await screen.findByRole('button', { name: /stop searching and edit my search/i }))

    await waitFor(() => expect(api.cancelled()).toBe(true))
    expect(await screen.findByRole('radiogroup', { name: /how do you want to pool/i })).toBeInTheDocument()
    expect(destField()).toHaveValue(airport.label)
  })

  it('keeps the number of people between 1 and the maximum', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await cabMode(u)
    const people = () => screen.getByText('1').closest('span')!.textContent
    await u.click(screen.getByRole('button', { name: /fewer people/i }))
    expect(people()).toBe('1')

    for (let i = 0; i < 10; i++) await u.click(screen.getByRole('button', { name: /more people/i }))
    expect(screen.getByText('6')).toBeInTheDocument()
  })
})

describe('PoolInPage: arrival time, places and errors', () => {
  it('takes a chosen clock time to mean its next occurrence: sent as a real moment within the next day', async () => {
    const api = stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    const before = Date.now()
    await submit(u)
    await screen.findByRole('heading', { name: /your pool request is saved/i })

    const arrive = new Date(api.posted().arriveBy)
    expect(arrive.getHours()).toBe(18)
    expect(arrive.getMinutes()).toBe(30)
    expect(arrive.getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000)
    expect(arrive.getTime()).toBeLessThanOrEqual(before + 24 * 3_600_000 + 10 * 60_000)
  })

  it('tells the user which day their time was taken to mean', async () => {
    stubApi()
    stubGeolocation()
    renderPage()
    await ready()

    expect(screen.getByText(/the latest time you need to arrive/i)).toBeInTheDocument()
    fireEvent.change(arrival(), { target: { value: TIME } })
    expect(screen.getByText(/we'll plan for (today|tomorrow) at 6:30 pm\./i)).toBeInTheDocument()
  })

  it('sends a time that is only minutes away for tomorrow, and says so', async () => {
    const api = stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    fireEvent.change(arrival(), { target: { value: clockIn(5) } })
    expect(screen.getByText(/we'll plan for tomorrow at/i)).toBeInTheDocument()

    await cabMode(u)
    await submit(u)
    await screen.findByRole('heading', { name: /your pool request is saved/i })

    const ms = new Date(api.posted().arriveBy).getTime() - Date.now()
    // Tomorrow at (now + ~5 min): a day and a few minutes from now.
    expect(ms).toBeGreaterThan(23 * 3_600_000)
    expect(ms).toBeLessThan(24 * 3_600_000 + 6 * 60_000)
  })

  it('needs a time to be chosen', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/choose the time you need to arrive/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('requires a place from the list when search is working', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.type(destField(), 'somewhere I made up')
    await screen.findAllByRole('option') // search answered, so it is working
    fireEvent.change(arrival(), { target: { value: TIME } })
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/choose a place from the suggestions/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('accepts typed text when place search is down, saving it without coordinates', async () => {
    const api = stubApi({ places: () => fail(502, 'MAPS_UNAVAILABLE', 'down'), pools: () => ok(cabCreated, 201) })
    const u = userEvent.setup()
    renderPage()

    await u.type(startField(), 'Indiranagar')
    expect(await screen.findByText(/place search is unavailable right now/i)).toBeInTheDocument()
    await u.type(destField(), 'Airport')
    fireEvent.change(arrival(), { target: { value: TIME } })
    await cabMode(u)
    await submit(u)

    await screen.findByRole('heading', { name: /your pool request is saved/i })
    expect(api.posted().origin).toEqual({ label: 'Indiranagar' })
    expect(api.posted().destination).toEqual({ label: 'Airport' })
  })

  it('keeps the form usable when the route cannot be calculated, and says why', async () => {
    stubApi({ route: () => fail(422, 'NO_ROUTE', 'No driving route was found between these two places.') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    expect(await screen.findByText(/no driving route was found/i)).toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('puts a server validation message on the matching field', async () => {
    stubApi({
      pools: () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid input', [
          { path: 'destination.label', message: 'Destination must be different from the starting location' },
        ]),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/destination must be different/i)).toBeInTheDocument()
    expect(destField()).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a luggage problem reported by the server as a message above the button', async () => {
    stubApi({
      pools: () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid input', [{ path: 'luggage.large', message: 'At most 10 of each' }]),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/luggage: at most 10 of each/i)).toBeInTheDocument()
  })

  it('shows other server errors (duplicate, limits) as a message above the button', async () => {
    stubApi({ pools: () => fail(409, 'DUPLICATE_POOL', 'You already have a pool for this route and arrival time') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/already have a pool for this route/i)).toBeInTheDocument()
  })

  it('shows a friendly message when the server is unreachable', async () => {
    stubApi({ pools: () => { throw new TypeError('Failed to fetch') } })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })
})
